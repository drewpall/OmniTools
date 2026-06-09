/**
 * iOS IPA Signer logic for OmniTools
 * Powered by WebAssembly (zsign compiled via Emscripten)
 */

(function () {
    // State variables
    let zsignResigner = null;
    let isInitializing = false;
    let isSigning = false;
    
    // OTA install state
    let lastSignedBlob = null;
    let lastSignedName = '';
    let lastSignedBundleId = '';

    // Custom App Icon state
    let customIconFile = null;

    // Dynamic Library (.dylib) & ZIP caching state
    let customDylibFile = null;
    let ipaZipInstance = null;

    // Info.plist State
    let originalPlistData = null;
    let plistPathInZip = '';
    let isLocalServerAvailable = false;

    // Files state
    const files = {
        ipa: null,
        p12: null,
        prov: null,
        ent: null
    };

    const directFiles = {
        ipa: null
    };

    // UI Console Logging function
    function logToConsole(message) {
        const consoleEl = document.getElementById('ipa-console');
        if (!consoleEl) return;
        const timestamp = new Date().toLocaleTimeString();
        consoleEl.textContent += `[${timestamp}] ${message}\n`;
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }

    function clearConsole() {
        const consoleEl = document.getElementById('ipa-console');
        if (consoleEl) {
            consoleEl.textContent = '';
        }
    }

    // Helper: update circular progress bar
    function updateProgress(percentage, statusTitle, statusDesc) {
        const circle = document.getElementById('ipa-progress-indicator-circle');
        const display = document.getElementById('ipa-progress-display');
        const titleEl = document.getElementById('ipa-progress-status-title');
        const descEl = document.getElementById('ipa-progress-status-desc');

        if (circle) {
            const radius = circle.r.baseVal.value;
            const circumference = 2 * Math.PI * radius;
            const offset = circumference - (percentage / 100) * circumference;
            circle.style.strokeDashoffset = offset;
        }

        if (display) {
            display.textContent = `${percentage}%`;
        }

        if (titleEl) {
            titleEl.innerHTML = statusTitle;
        }

        if (descEl) {
            descEl.innerHTML = statusDesc;
        }
    }

    // Initialize signing engine
    async function initSigner() {
        if (zsignResigner) return zsignResigner;
        if (isInitializing) return null;
        isInitializing = true;

        logToConsole(window.t("正在本地加载 WebAssembly 签名引擎...", "Loading WebAssembly signing engine locally..."));

        try {
            // 1. Fetch zsign-wasm.min.js
            const response = await fetch('./zsign-wasm.min.js');
            if (!response.ok) {
                throw new Error(`Failed to load engine script: ${response.status} ${response.statusText}`);
            }
            const source = await response.text();

            // 2. Evaluate script to fetch createZsignModule and ZsignWasmClient
            const cjsModule = { exports: {} };
            const evaluate = new Function('module', 'exports', 'require', '__filename', '__dirname', 'globalThis', source);
            evaluate(cjsModule, cjsModule.exports, undefined, './zsign-wasm.min.js', '', window);
            
            const wasmBundle = cjsModule.exports;
            if (!wasmBundle || typeof wasmBundle.ZsignWasmClient !== 'function') {
                throw new Error("Invalid WebAssembly bundle exports.");
            }

            const { ZsignWasmClient } = wasmBundle;
            const moduleFactory = wasmBundle.createEmbeddedZsignModule || wasmBundle.createZsignModule;

            // 3. Instantiate Emscripten client
            const client = await ZsignWasmClient.create({
                moduleFactory,
                moduleOptions: {
                    print: (text) => {
                        logToConsole(text);
                    },
                    printErr: (text) => {
                        logToConsole(`[ERROR] ${text}`);
                    },
                    locateFile: (path) => {
                        if (path.endsWith('.wasm')) {
                            return './zsign-wasm.wasm';
                        }
                        return path;
                    }
                }
            });

            zsignResigner = client;
            isInitializing = false;
            logToConsole(window.t("签名引擎初始化成功！已支持本地代码签名。", "Signing engine initialized successfully! Local signing is ready."));
            return zsignResigner;
        } catch (err) {
            isInitializing = false;
            logToConsole(window.t(`签名引擎加载失败: ${err.message}`, `Engine loading failed: ${err.message}`));
            console.error(err);
            throw err;
        }
    }

    // Helper: read file as ArrayBuffer
    function readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(new Uint8Array(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(file);
        });
    }

    // Helper: normalize paths for zip extraction
    function normalizePath(p) {
        return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
    }

    // Core signing process
    async function startSigning() {
        if (isSigning) return;
        
        // Validation checks
        if (!files.ipa) {
            alert(window.t("请先选择 IPA 软件包文件！", "Please choose an IPA package file first!"));
            return;
        }
        if (!files.p12) {
            alert(window.t("请先选择 P12 证书文件！", "Please choose a P12 certificate file first!"));
            return;
        }
        if (!files.prov) {
            alert(window.t("请先选择描述文件 (.mobileprovision)！", "Please choose a provisioning profile first!"));
            return;
        }

        const password = document.getElementById('ipa-password-input').value;
        const newBundleId = document.getElementById('ipa-new-bundleid').value;
        const newName = document.getElementById('ipa-new-name').value;
        const newVersion = document.getElementById('ipa-new-version').value;
        const adhoc = document.getElementById('ipa-opt-adhoc').checked;
        const weakInject = document.getElementById('ipa-opt-weak').checked;

        isSigning = true;
        document.getElementById('ipa-progress-panel').style.display = 'block';
        document.getElementById('btn-ipa-sign').disabled = true;
        document.getElementById('btn-ipa-reset').style.display = 'none';
        clearConsole();

        try {
            // Ensure engine is loaded
            const client = await initSigner();
            const fs = client.mod.FS;
            if (!fs) {
                throw new Error("Emscripten filesystem is not available.");
            }

            // 1. Load zip content
            let inputZip;
            if (ipaZipInstance) {
                inputZip = ipaZipInstance;
                updateProgress(10, window.t("读取缓存中...", "Reading cache..."), window.t("正在从工作区读取已加载的 IPA 包...", "Reading cached IPA package structure..."));
            } else {
                updateProgress(10, window.t("解压中...", "Extracting..."), window.t("正在本地提取 IPA 软件包结构...", "Extracting IPA package structure locally..."));
                const ipaBytes = await readFileAsArrayBuffer(files.ipa);
                inputZip = await window.JSZip.loadAsync(ipaBytes);
            }

            // 1.2 Info.plist Modifications
            if (originalPlistData && isLocalServerAvailable) {
                updateProgress(15, window.t("修改配置文件...", "Modifying config..."), window.t("正在应用修改后的 plist 配置参数...", "Applying modified plist config..."));
                await applyPlistModifications();
            }

            // 1.5 Custom App Icon replacement (if provided)
            if (customIconFile) {
                updateProgress(20, window.t("更换图标...", "Replacing icon..."), window.t("正在应用个性化应用图标...", "Applying custom app icon..."));
                logToConsole(window.t("正在扫描 IPA 内的所有图标文件...", "Scanning IPA for icon files..."));
                
                const iconRegex = /Payload\/[^/]+\.app\/(?:AppIcon|Icon|icon|App-Icon)[^/]*\.png$/i;
                const matchingIcons = Object.keys(inputZip.files).filter(name => iconRegex.test(name));
                
                if (matchingIcons.length > 0) {
                    const iconBytes = await readFileAsArrayBuffer(customIconFile);
                    for (const iconPath of matchingIcons) {
                        logToConsole(window.t(`替换图标文件: ${iconPath}`, `Replacing icon file: ${iconPath}`));
                        inputZip.file(iconPath, iconBytes);
                    }
                    logToConsole(window.t(`成功替换 ${matchingIcons.length} 个图标文件！`, `Successfully replaced ${matchingIcons.length} icon files!`));
                } else {
                    logToConsole(window.t("[警告] 未能在 IPA 中定位到标准图标文件，将尝试创建默认图标。", "[Warning] No standard icon files located in IPA, attempting to create default icon."));
                    const appFolder = Object.keys(inputZip.files).find(name => name.startsWith('Payload/') && name.endsWith('.app/'));
                    if (appFolder) {
                        const iconBytes = await readFileAsArrayBuffer(customIconFile);
                        inputZip.file(`${appFolder}AppIcon60x60@2x.png`, iconBytes);
                        inputZip.file(`${appFolder}AppIcon60x60@3x.png`, iconBytes);
                        logToConsole(window.t("在 App Bundle 中写入默认 icon 资产。", "Wrote default icon assets in App Bundle."));
                    }
                }
            }

            // 1.7 Dylib Injection (if provided)
            if (customDylibFile) {
                updateProgress(25, window.t("注入动态库...", "Injecting dylib..."), window.t("正在将动态库注入到主二进制程序中...", "Injecting dynamic library into main binary..."));
                
                // Locate main executable
                let executableName = '';
                const appFolder = Object.keys(inputZip.files).find(name => name.startsWith('Payload/') && name.endsWith('.app/'));
                if (appFolder) {
                    const folderBaseName = appFolder.substring(appFolder.indexOf('/') + 1, appFolder.lastIndexOf('.app/'));
                    const exePath = `${appFolder}${folderBaseName}`;
                    if (inputZip.files[exePath]) {
                        executableName = exePath;
                    }
                    
                    if (!executableName) {
                        executableName = `${appFolder}${folderBaseName}`;
                    }
                }

                if (executableName && inputZip.files[executableName]) {
                    logToConsole(window.t(`定位到主可执行程序: ${executableName}`, `Located main executable: ${executableName}`));
                    
                    const exeBytes = await inputZip.files[executableName].async('uint8array');
                    const dylibName = customDylibFile.name;
                    const dylibPath = `@executable_path/Frameworks/${dylibName}`;
                    
                    logToConsole(window.t(`向可执行文件注入加载路径: ${dylibPath}`, `Injecting load path into executable: ${dylibPath}`));
                    
                    const patchedBytes = injectDylibToMacho(exeBytes, dylibPath);
                    if (patchedBytes) {
                        inputZip.file(executableName, patchedBytes);
                        
                        const dylibBytes = await readFileAsArrayBuffer(customDylibFile);
                        const destDylibPath = `${appFolder}Frameworks/${dylibName}`;
                        inputZip.file(destDylibPath, dylibBytes);
                        
                        logToConsole(window.t(`动态库注入成功并保存到 Frameworks 目录！`, `Dylib successfully injected and saved to Frameworks directory!`));
                    } else {
                        throw new Error(window.t("主二进制 Mach-O 加载命令注入失败！可能是 Padding 空间不足或文件损坏。", "Failed to inject load command into Mach-O binary. Possibly insufficient header padding or corrupted binary."));
                    }
                } else {
                    throw new Error(window.t("未能在 IPA 包内定位到主可执行文件！无法进行动态库注入。", "Could not locate main executable inside the IPA. Dylib injection aborted."));
                }
            }

            // 2. Stage workspace folders in virtual FS
            updateProgress(30, window.t("准备工作区...", "Staging..."), window.t("建立虚拟签名工作空间...", "Staging signing sandbox..."));
            const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
            const workspace = `/zsign_ws_${suffix}`;
            const inputRoot = `${workspace}/input`;
            const assetRoot = `${workspace}/assets`;

            fs.mkdirTree(inputRoot);
            fs.mkdirTree(assetRoot);

            // 3. Write unzip files to virtual FS
            const names = Object.keys(inputZip.files);
            const totalFiles = names.length;
            let currentFileIdx = 0;

            for (const name of names) {
                const entry = inputZip.files[name];
                const cleanName = normalizePath(name);
                if (!cleanName) continue;

                const outPath = `${inputRoot}/${cleanName}`;
                if (entry.dir) {
                    fs.mkdirTree(outPath);
                } else {
                    const idx = outPath.lastIndexOf('/');
                    if (idx > 0) {
                        fs.mkdirTree(outPath.slice(0, idx));
                    }
                    const data = await entry.async('uint8array');
                    fs.writeFile(outPath, data, { canOwn: true });
                }

                currentFileIdx++;
                if (currentFileIdx % 20 === 0 || currentFileIdx === totalFiles) {
                    const percent = 30 + Math.floor((currentFileIdx / totalFiles) * 20); // 30% -> 50%
                    updateProgress(percent, window.t("准备工作区...", "Staging..."), window.t(`已提取 ${currentFileIdx} / ${totalFiles} 个文件...`, `Extracted ${currentFileIdx} / ${totalFiles} files...`));
                }
            }

            // 4. Write credentials
            updateProgress(55, window.t("写入凭证...", "Writing credentials..."), window.t("写入 P12 证书与描述文件...", "Writing P12 certificate and provisioning profile..."));
            const p12Bytes = await readFileAsArrayBuffer(files.p12);
            const provBytes = await readFileAsArrayBuffer(files.prov);
            
            // Note: C++ zsign checks the file extension (.p12) to detect PKCS12 format.
            const pkeyFile = `${assetRoot}/cert.p12`;
            fs.writeFile(pkeyFile, p12Bytes, { canOwn: true });
            const certFile = ''; // empty, loaded from p12 directly

            const provFile = `${assetRoot}/prov.mobileprovision`;
            fs.writeFile(provFile, provBytes, { canOwn: true });

            let entitlementsFile = '';
            if (files.ent) {
                const entBytes = await readFileAsArrayBuffer(files.ent);
                entitlementsFile = `${assetRoot}/entitlements.plist`;
                fs.writeFile(entitlementsFile, entBytes, { canOwn: true });
            }

            // 5. Code signing execution
            updateProgress(65, window.t("执行代码签名...", "Signing Code..."), window.t("签名引擎正在为 Mach-O 目标签名...", "Signing engine is signature-patching Mach-O binaries..."));
            
            client.signBundle(inputRoot, {
                certFile,
                pkeyFile,
                provFile,
                password: password || '',
                entitlementsFile,
                bundleId: newBundleId || '',
                bundleVersion: newVersion || '',
                displayName: newName || '',
                adhoc: adhoc,
                sha256Only: false,
                forceSign: true,
                weakInject: weakInject,
                enableCache: false
            });

            // 6. Zip back signed files
            updateProgress(85, window.t("重新打包...", "Packaging..."), window.t("重新打包为已签名的 IPA 软件...", "Compressing signed payload back to IPA..."));
            const outZip = new window.JSZip();

            // Walk files recursively and add to zip
            function walkAndZip(rootPath) {
                const entries = fs.readdir(rootPath);
                for (const name of entries) {
                    if (name === '.' || name === '..') continue;
                    const fullPath = `${rootPath}/${name}`;
                    const st = fs.stat(fullPath);
                    if (fs.isDir(st.mode)) {
                        walkAndZip(fullPath);
                    } else if (fs.isFile(st.mode)) {
                        const relPath = fullPath.slice(inputRoot.length + 1);
                        const fileData = fs.readFile(fullPath, { encoding: 'binary' });
                        outZip.file(relPath, fileData);
                    }
                }
            }
            walkAndZip(inputRoot);

            const signedBytes = await outZip.generateAsync({
                type: 'uint8array',
                compression: 'DEFLATE',
                compressionOptions: {
                    level: 6
                }
            });

            // 7. Cleanup VM FS
            updateProgress(95, window.t("清理缓存...", "Cleaning up..."), window.t("正在清理工作区垃圾文件...", "Cleaning up sandbox files..."));
            
            function rmrf(pathname) {
                const info = fs.analyzePath(pathname);
                if (!info.exists) return;
                const st = fs.stat(pathname);
                if (fs.isDir(st.mode)) {
                    const entries = fs.readdir(pathname);
                    for (const name of entries) {
                        if (name === '.' || name === '..') continue;
                        rmrf(`${pathname}/${name}`);
                    }
                    fs.rmdir(pathname);
                } else {
                    fs.unlink(pathname);
                }
            }
            rmrf(workspace);

            // 8. Sign complete! Download file
            updateProgress(100, window.t("签名成功！", "Signing Success!"), window.t("已生成签名的 IPA，开始下载...", "Signed IPA created. Downloading..."));
            
            const originalName = files.ipa.name.replace(/\.ipa$/, '');
            const outputFileName = `${originalName}_signed.ipa`;
            const blob = new Blob([signedBytes], { type: 'application/octet-stream' });
            
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = outputFileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Save for local wireless installation
            lastSignedBlob = blob;
            lastSignedName = newName || originalName;
            lastSignedBundleId = newBundleId || 'com.custom.app';
            
            const installOptions = document.getElementById('ipa-install-options');
            if (installOptions) {
                installOptions.style.display = 'block';
            }

            isSigning = false;
            document.getElementById('btn-ipa-sign').disabled = false;
            document.getElementById('btn-ipa-reset').style.display = 'block';

        } catch (err) {
            isSigning = false;
            document.getElementById('btn-ipa-sign').disabled = false;
            document.getElementById('btn-ipa-reset').style.display = 'block';
            updateProgress(0, window.t("签名失败！", "Signing Failed!"), window.t(`错误信息: ${err.message}`, `Error: ${err.message}`));
            logToConsole(`[ERROR] Signing failed: ${err.message}`);
            console.error(err);
        }
    }

    // Reset inputs
    function resetSigner() {
        files.ipa = null;
        files.p12 = null;
        files.prov = null;
        files.ent = null;
        
        lastSignedBlob = null;
        lastSignedName = '';
        lastSignedBundleId = '';
        customIconFile = null;
        customDylibFile = null;
        ipaZipInstance = null;

        document.getElementById('ipa-p12-input').value = '';
        document.getElementById('ipa-prov-input').value = '';
        document.getElementById('ipa-ent-input').value = '';
        document.getElementById('ipa-file-input').value = '';
        document.getElementById('ipa-password-input').value = '';
        document.getElementById('ipa-new-bundleid').value = '';
        document.getElementById('ipa-new-name').value = '';
        document.getElementById('ipa-new-version').value = '';
        document.getElementById('ipa-opt-adhoc').checked = false;
        document.getElementById('ipa-opt-weak').checked = false;

        // Reset Plist variables
        originalPlistData = null;
        plistPathInZip = '';

        const minOsInput = document.getElementById('ipa-new-min-os');
        if (minOsInput) minOsInput.value = '';
        const fileshareCheck = document.getElementById('ipa-opt-fileshare');
        if (fileshareCheck) fileshareCheck.checked = false;
        const openinplaceCheck = document.getElementById('ipa-opt-openinplace');
        if (openinplaceCheck) openinplaceCheck.checked = false;
        const httpCheck = document.getElementById('ipa-opt-http');
        if (httpCheck) httpCheck.checked = false;
        const nodevicecapsCheck = document.getElementById('ipa-opt-nodevicecaps');
        if (nodevicecapsCheck) nodevicecapsCheck.checked = false;

        const saveExportBtn = document.getElementById('btn-ipa-save-export');
        if (saveExportBtn) saveExportBtn.style.display = 'none';

        updatePlistStatus(isLocalServerAvailable, isLocalServerAvailable ? window.t("本地服务已就绪", "Local Server Ready") : window.t("未连接本地服务", "Not Connected"));

        // Reset Icon Inputs
        const iconInput = document.getElementById('ipa-icon-input');
        if (iconInput) iconInput.value = '';
        const iconPreview = document.getElementById('icon-preview-container');
        if (iconPreview) iconPreview.style.display = 'none';
        const iconPlaceholder = document.getElementById('icon-upload-placeholder');
        if (iconPlaceholder) iconPlaceholder.style.display = 'flex';
        const iconInfo = document.getElementById('icon-file-info');
        if (iconInfo) iconInfo.style.display = 'none';

        // Reset Dylib Inputs
        const dylibInput = document.getElementById('ipa-dylib-input');
        if (dylibInput) dylibInput.value = '';
        const dylibInfo = document.getElementById('dylib-file-info');
        if (dylibInfo) dylibInfo.style.display = 'none';
        const dylibPlaceholder = document.getElementById('dylib-upload-placeholder');
        if (dylibPlaceholder) dylibPlaceholder.style.display = 'flex';

        // Reset File Explorer
        const explorerPanel = document.getElementById('ipa-explorer-panel');
        if (explorerPanel) explorerPanel.style.display = 'none';
        const explorerTbody = document.getElementById('ipa-explorer-tbody');
        if (explorerTbody) explorerTbody.innerHTML = '';

        document.getElementById('p12-file-info').style.display = 'none';
        document.getElementById('prov-file-info').style.display = 'none';
        document.getElementById('ent-file-info').style.display = 'none';
        document.getElementById('ipa-file-info').style.display = 'none';

        document.getElementById('p12-upload-box').style.display = 'block';
        document.getElementById('prov-upload-box').style.display = 'block';
        document.getElementById('ent-upload-box').style.display = 'block';
        document.getElementById('ipa-upload-box').style.display = 'block';

        // Direct Install Reset
        directFiles.ipa = null;
        const directInput = document.getElementById('ipa-direct-file-input');
        if (directInput) directInput.value = '';
        const directInfo = document.getElementById('ipa-direct-file-info');
        if (directInfo) directInfo.style.display = 'none';
        const directBox = document.getElementById('ipa-direct-upload-box');
        if (directBox) directBox.style.display = 'block';
        
        const directName = document.getElementById('ipa-direct-name');
        if (directName) directName.value = '';
        const directBundle = document.getElementById('ipa-direct-bundleid');
        if (directBundle) directBundle.value = '';

        const installOptions = document.getElementById('ipa-install-options');
        if (installOptions) installOptions.style.display = 'none';

        document.getElementById('ipa-progress-panel').style.display = 'none';
        document.getElementById('btn-ipa-reset').style.display = 'none';
        clearConsole();
    }

    // Bind file inputs and drag-drop events
    function setupDropzone(boxId, inputId, infoId, ext, fileKey) {
        const box = document.getElementById(boxId);
        const input = document.getElementById(inputId);
        const info = document.getElementById(infoId);

        if (!box || !input || !info) return;

        // Click box to trigger input click
        box.addEventListener('click', () => {
            input.click();
        });

        // File selection change
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                handleSelectedFile(file, box, info, fileKey);
            }
        });

        // Drag & drop styling
        box.addEventListener('dragover', (e) => {
            e.preventDefault();
            box.classList.add('dragover');
        });

        box.addEventListener('dragleave', () => {
            box.classList.remove('dragover');
        });

        box.addEventListener('drop', (e) => {
            e.preventDefault();
            box.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && file.name.endsWith(ext)) {
                handleSelectedFile(file, box, info, fileKey);
            } else {
                alert(window.t(`只能上传 ${ext} 格式的文件！`, `Only ${ext} files are supported!`));
            }
        });

        // Bind clear button
        const clearBtn = info.querySelector('.btn-clear-file');
        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                files[fileKey] = null;
                input.value = '';
                info.style.display = 'none';
                box.style.display = 'block';
                
                if (fileKey === 'ipa') {
                    ipaZipInstance = null;
                    const panel = document.getElementById('ipa-explorer-panel');
                    if (panel) panel.style.display = 'none';
                    const tbody = document.getElementById('ipa-explorer-tbody');
                    if (tbody) tbody.innerHTML = '';
                }
            });
        }
    }

    function handleSelectedFile(file, box, info, fileKey) {
        files[fileKey] = file;
        
        // Hide upload box, show badge
        box.style.display = 'none';
        info.style.display = 'flex';
        
        // Show file name
        const nameText = info.querySelector('.file-name-text');
        if (nameText) {
            // Show file name + formatted size
            const sizeKB = (file.size / 1024).toFixed(1);
            const sizeStr = sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;
            nameText.textContent = `${file.name} (${sizeStr})`;
        }

        if (fileKey === 'ipa') {
            loadIpaZip(file);
        }

        // Trigger dynamic loading of wasm engine as soon as first file is selected
        initSigner().catch(() => {});
    }

    // Helper: Upload & Install iOS Manifest triggers
    async function uploadAndInstall(ipaBlob, appName, bundleId) {
        if (!ipaBlob) {
            alert(window.t("无可用的已签名 IPA 文件！", "No signed IPA file available!"));
            return;
        }

        updateProgress(0, window.t("正在上传...", "Uploading..."), window.t("正在上传 IPA 文件到本地临时服务器以启动安装...", "Uploading IPA file to local temp server to initiate install..."));
        document.getElementById('ipa-progress-panel').style.display = 'block';
        clearConsole();

        try {
            // Upload IPA to Python server
            const response = await fetch('/api/upload-ipa', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/octet-stream'
                },
                body: ipaBlob
            });

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
            }

            const resData = await response.json();
            if (!resData.success || !resData.id) {
                throw new Error(resData.error || "Failed to parse upload response.");
            }

            const fileId = resData.id;
            updateProgress(100, window.t("上传成功！", "Upload Success!"), window.t("已生成安装描述文件，正在唤起系统安装弹窗...", "Manifest generated. Triggering system install dialog..."));
            logToConsole(window.t("唤起 iOS 系统无线安装中...", "Invoking iOS system wireless installation..."));

            // Generate itms-services url
            const origin = window.location.origin;
            const encodedName = encodeURIComponent(appName);
            const encodedBundle = encodeURIComponent(bundleId);
            const manifestUrl = `${origin}/api/manifest?id=${fileId}&name=${encodedName}&bundleId=${encodedBundle}&origin=${encodeURIComponent(origin)}`;
            const itmsUrl = `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;
            
            console.log("ITMS Services URL:", itmsUrl);
            window.location.href = itmsUrl;

        } catch (err) {
            updateProgress(0, window.t("安装失败！", "Installation Failed!"), window.t(`上传或配置失败: ${err.message}`, `Upload or config failed: ${err.message}`));
            logToConsole(`[ERROR] Installation trigger failed: ${err.message}`);
            alert(window.t(`安装失败: ${err.message}`, `Installation failed: ${err.message}`));
        }
    }

    async function startDirectInstall() {
        if (!directFiles.ipa) {
            alert(window.t("请先选择 IPA 软件包文件！", "Please choose an IPA package file first!"));
            return;
        }

        const appNameInput = document.getElementById('ipa-direct-name').value.trim();
        const bundleIdInput = document.getElementById('ipa-direct-bundleid').value.trim();

        if (!appNameInput) {
            alert(window.t("请输入应用名称！", "Please enter the App Name!"));
            return;
        }
        if (!bundleIdInput) {
            alert(window.t("请输入 Bundle ID！", "Please enter the Bundle ID!"));
            return;
        }

        // Trigger upload and install
        await uploadAndInstall(directFiles.ipa, appNameInput, bundleIdInput);
    }

    function setupDirectDropzone() {
        const box = document.getElementById('ipa-direct-upload-box');
        const input = document.getElementById('ipa-direct-file-input');
        const info = document.getElementById('ipa-direct-file-info');

        if (!box || !input || !info) return;

        // Reset click listener
        box.replaceWith(box.cloneNode(true));
        const newBox = document.getElementById('ipa-direct-upload-box');

        newBox.addEventListener('click', () => {
            input.click();
        });

        // Reset change listener
        input.replaceWith(input.cloneNode(true));
        const newInput = document.getElementById('ipa-direct-file-input');

        newInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                handleDirectFile(file, newBox, info);
            }
        });

        newBox.addEventListener('dragover', (e) => {
            e.preventDefault();
            newBox.classList.add('dragover');
        });

        newBox.addEventListener('dragleave', () => {
            newBox.classList.remove('dragover');
        });

        newBox.addEventListener('drop', (e) => {
            e.preventDefault();
            newBox.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && file.name.endsWith('.ipa')) {
                handleDirectFile(file, newBox, info);
            } else {
                alert(window.t("只能上传 .ipa 格式的文件！", "Only .ipa files are supported!"));
            }
        });

        // Bind clear button
        const clearBtn = info.querySelector('.btn-clear-file');
        if (clearBtn) {
            clearBtn.replaceWith(clearBtn.cloneNode(true));
            const newClearBtn = info.querySelector('.btn-clear-file');
            newClearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                directFiles.ipa = null;
                newInput.value = '';
                info.style.display = 'none';
                newBox.style.display = 'block';
                const directName = document.getElementById('ipa-direct-name');
                if (directName) directName.value = '';
                const directBundle = document.getElementById('ipa-direct-bundleid');
                if (directBundle) directBundle.value = '';
            });
        }
    }

    function handleDirectFile(file, box, info) {
        directFiles.ipa = file;
        
        box.style.display = 'none';
        info.style.display = 'flex';
        
        const nameText = info.querySelector('.file-name-text');
        if (nameText) {
            const sizeKB = (file.size / 1024).toFixed(1);
            const sizeStr = sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;
            nameText.textContent = `${file.name} (${sizeStr})`;
        }

        // Auto fill app name and bundle id defaults from filename
        const baseName = file.name.replace(/\.ipa$/i, '');
        const cleanName = baseName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, ' ').trim();
        const safeId = baseName.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        const nameInput = document.getElementById('ipa-direct-name');
        const bundleInput = document.getElementById('ipa-direct-bundleid');

        if (nameInput && !nameInput.value) {
            nameInput.value = cleanName || "MyApp";
        }
        if (bundleInput && !bundleInput.value) {
            bundleInput.value = `com.custom.${safeId || "myapp"}`;
        }
    }

    function setupTabs() {
        const signBtn = document.getElementById('tab-ipa-sign-btn');
        const directBtn = document.getElementById('tab-ipa-direct-btn');
        const signSection = document.getElementById('ipa-sign-section');
        const directSection = document.getElementById('ipa-direct-section');

        if (!signBtn || !directBtn || !signSection || !directSection) return;

        signBtn.addEventListener('click', () => {
            signBtn.classList.add('active');
            directBtn.classList.remove('active');
            signSection.style.display = 'flex';
            directSection.style.display = 'none';
            document.getElementById('ipa-progress-panel').style.display = 'none';
        });

        directBtn.addEventListener('click', () => {
            directBtn.classList.add('active');
            signBtn.classList.remove('active');
            directSection.style.display = 'flex';
            signSection.style.display = 'none';
            document.getElementById('ipa-progress-panel').style.display = 'none';
        });
    }

    function setupIconUploader() {
        const box = document.getElementById('icon-upload-box');
        const input = document.getElementById('ipa-icon-input');
        const info = document.getElementById('icon-file-info');
        const preview = document.getElementById('icon-preview-container');
        const previewImg = document.getElementById('icon-preview-img');
        const previewName = document.getElementById('icon-preview-name');
        const placeholder = document.getElementById('icon-upload-placeholder');
        const clearBtn = document.getElementById('btn-clear-icon');

        if (!box || !input) return;

        box.addEventListener('click', () => {
            input.click();
        });

        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                handleIconFile(file);
            }
        });

        box.addEventListener('dragover', (e) => {
            e.preventDefault();
            box.style.borderColor = 'var(--primary-light)';
            box.style.background = 'rgba(139, 92, 246, 0.05)';
        });

        box.addEventListener('dragleave', () => {
            box.style.borderColor = 'var(--border-color)';
            box.style.background = 'rgba(255, 255, 255, 0.01)';
        });

        box.addEventListener('drop', (e) => {
            e.preventDefault();
            box.style.borderColor = 'var(--border-color)';
            box.style.background = 'rgba(255, 255, 255, 0.01)';
            const file = e.dataTransfer.files[0];
            if (file && (file.type.startsWith('image/png') || file.type.startsWith('image/jpeg'))) {
                handleIconFile(file);
            } else {
                alert(window.t("只能使用 PNG 或 JPG 图片作为图标！", "Only PNG or JPG images can be used as icons!"));
            }
        });

        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                customIconFile = null;
                input.value = '';
                if (preview) preview.style.display = 'none';
                if (placeholder) placeholder.style.display = 'flex';
                if (info) info.style.display = 'none';
            });
        }

        function handleIconFile(file) {
            customIconFile = file;
            if (placeholder) placeholder.style.display = 'none';
            if (preview) preview.style.display = 'flex';
            if (info) info.style.display = 'flex';
            if (previewName) previewName.textContent = file.name;

            const reader = new FileReader();
            reader.onload = (e) => {
                if (previewImg) previewImg.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    }

    // Info.plist visual editor functions
    function updatePlistStatus(available, text) {
        const badge = document.getElementById('ipa-plist-status-badge');
        const container = badge ? badge.closest('.config-section') : null;
        const inputsContainer = container ? container.querySelector('#ipa-settings-content') : null;

        if (badge) {
            badge.textContent = text;
            if (available) {
                badge.style.background = 'rgba(16, 185, 129, 0.1)';
                badge.style.border = '1px solid rgba(16, 185, 129, 0.2)';
                badge.style.color = '#10B981';
            } else {
                badge.style.background = 'rgba(239, 68, 68, 0.1)';
                badge.style.border = '1px solid rgba(239, 68, 68, 0.2)';
                badge.style.color = '#EF4444';
            }
        }
    }

    async function parseInfoPlist(plistBytes) {
        try {
            const response = await fetch('/api/parse-plist', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/octet-stream'
                },
                body: plistBytes
            });

            if (!response.ok) {
                throw new Error(`Server returned status: ${response.status}`);
            }

            const resData = await response.json();
            if (resData.success && resData.data) {
                isLocalServerAvailable = true;
                originalPlistData = resData.data;
                logToConsole(window.t("本地服务成功解析 Info.plist！正在自动填入配置参数。", "Info.plist successfully parsed by local server! Populating fields."));
                
                // Populate core inputs
                const nameInput = document.getElementById('ipa-new-name');
                const bundleInput = document.getElementById('ipa-new-bundleid');
                const versionInput = document.getElementById('ipa-new-version');
                const minOsInput = document.getElementById('ipa-new-min-os');

                const displayName = originalPlistData.CFBundleDisplayName || originalPlistData.CFBundleName || '';
                const bundleId = originalPlistData.CFBundleIdentifier || '';
                const version = originalPlistData.CFBundleShortVersionString || originalPlistData.CFBundleVersion || '';
                const minOs = originalPlistData.MinimumOSVersion || '';

                if (nameInput && !nameInput.value) nameInput.value = displayName;
                if (bundleInput && !bundleInput.value) bundleInput.value = bundleId;
                if (versionInput && !versionInput.value) versionInput.value = version;
                if (minOsInput && !minOsInput.value) minOsInput.value = minOs;

                // Populate checkboxes
                const fileshareCheck = document.getElementById('ipa-opt-fileshare');
                const openinplaceCheck = document.getElementById('ipa-opt-openinplace');
                const httpCheck = document.getElementById('ipa-opt-http');
                const nodevicecapsCheck = document.getElementById('ipa-opt-nodevicecaps');

                if (fileshareCheck) fileshareCheck.checked = !!originalPlistData.UIFileSharingEnabled;
                if (openinplaceCheck) openinplaceCheck.checked = !!originalPlistData.LSSupportsOpeningDocumentsInPlace;

                // Check HTTP transport security
                if (httpCheck) {
                    if (originalPlistData.NSAppTransportSecurity && originalPlistData.NSAppTransportSecurity.NSAllowsArbitraryLoads) {
                        httpCheck.checked = true;
                    } else {
                        httpCheck.checked = false;
                    }
                }

                // Check device capabilities restrictions
                if (nodevicecapsCheck) {
                    const caps = originalPlistData.UIRequiredDeviceCapabilities;
                    if (!caps || (Array.isArray(caps) && caps.length === 0) || (typeof caps === 'object' && Object.keys(caps).length === 0)) {
                        nodevicecapsCheck.checked = true;
                    } else {
                        nodevicecapsCheck.checked = false;
                    }
                }

                updatePlistStatus(true, window.t("本地服务已连接", "Local Server Connected"));
            } else {
                throw new Error(resData.error || "Unknown parse error");
            }
        } catch (err) {
            isLocalServerAvailable = false;
            originalPlistData = null;
            logToConsole(window.t(`[警告] 无法使用本地服务解析 Info.plist: ${err.message}。配置编辑不可用。`, `[Warning] Failed to parse Info.plist via local server: ${err.message}. Config editing disabled.`));
            updatePlistStatus(false, window.t("未运行本地服务", "Local Server Offline"));
        }
    }

    async function applyPlistModifications() {
        if (!originalPlistData || !isLocalServerAvailable || !plistPathInZip || !ipaZipInstance) {
            return null; // Plist editing not active or not supported
        }

        logToConsole(window.t("正在应用 Info.plist 参数修改...", "Applying Info.plist modifications..."));

        const plistCopy = JSON.parse(JSON.stringify(originalPlistData));

        // 1. Sync core fields
        const newName = document.getElementById('ipa-new-name').value.trim();
        const newBundleId = document.getElementById('ipa-new-bundleid').value.trim();
        const newVersion = document.getElementById('ipa-new-version').value.trim();
        const newMinOs = document.getElementById('ipa-new-min-os').value.trim();

        if (newName) {
            plistCopy.CFBundleDisplayName = newName;
            plistCopy.CFBundleName = newName;
        }
        if (newBundleId) {
            plistCopy.CFBundleIdentifier = newBundleId;
        }
        if (newVersion) {
            plistCopy.CFBundleShortVersionString = newVersion;
            plistCopy.CFBundleVersion = newVersion;
        }
        if (newMinOs) {
            plistCopy.MinimumOSVersion = newMinOs;
        }

        // 2. Checkboxes
        const fileshareCheck = document.getElementById('ipa-opt-fileshare');
        const openinplaceCheck = document.getElementById('ipa-opt-openinplace');
        const httpCheck = document.getElementById('ipa-opt-http');
        const nodevicecapsCheck = document.getElementById('ipa-opt-nodevicecaps');

        if (fileshareCheck) {
            if (fileshareCheck.checked) {
                plistCopy.UIFileSharingEnabled = true;
            } else {
                delete plistCopy.UIFileSharingEnabled;
            }
        }

        if (openinplaceCheck) {
            if (openinplaceCheck.checked) {
                plistCopy.LSSupportsOpeningDocumentsInPlace = true;
            } else {
                delete plistCopy.LSSupportsOpeningDocumentsInPlace;
            }
        }

        if (httpCheck) {
            if (httpCheck.checked) {
                if (!plistCopy.NSAppTransportSecurity) {
                    plistCopy.NSAppTransportSecurity = {};
                }
                plistCopy.NSAppTransportSecurity.NSAllowsArbitraryLoads = true;
            } else {
                if (plistCopy.NSAppTransportSecurity) {
                    delete plistCopy.NSAppTransportSecurity.NSAllowsArbitraryLoads;
                    if (Object.keys(plistCopy.NSAppTransportSecurity).length === 0) {
                        delete plistCopy.NSAppTransportSecurity;
                    }
                }
            }
        }

        if (nodevicecapsCheck && nodevicecapsCheck.checked) {
            delete plistCopy.UIRequiredDeviceCapabilities;
        }

        try {
            // Send back to server to build binary plist bytes
            const response = await fetch('/api/build-plist', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ data: plistCopy })
            });

            if (!response.ok) {
                throw new Error(`Server returned build status: ${response.status}`);
            }

            const binaryArrayBuffer = await response.arrayBuffer();
            const binaryBytes = new Uint8Array(binaryArrayBuffer);

            // Overwrite inside JSZip
            ipaZipInstance.file(plistPathInZip, binaryBytes);
            logToConsole(window.t("Info.plist 内存覆盖成功！已写入最新的配置参数。", "Info.plist overwritten in memory successfully with updated config!"));
            return true;
        } catch (err) {
            logToConsole(`[ERROR] Failed to compile modified Info.plist: ${err.message}`);
            alert(window.t(`配置文件编译失败: ${err.message}`, `Failed to compile Info.plist: ${err.message}`));
            return false;
        }
    }

    async function saveAndExportIPA() {
        if (!files.ipa) {
            alert(window.t("请先选择 IPA 软件包文件！", "Please choose an IPA package file first!"));
            return;
        }

        const btn = document.getElementById('btn-ipa-save-export');
        if (btn) btn.disabled = true;
        document.getElementById('ipa-progress-panel').style.display = 'block';
        clearConsole();

        try {
            updateProgress(10, window.t("读取包结构...", "Reading package..."), window.t("正在提取并解析文件结构...", "Extracting package structure..."));
            
            let inputZip;
            if (ipaZipInstance) {
                inputZip = ipaZipInstance;
            } else {
                const ipaBytes = await readFileAsArrayBuffer(files.ipa);
                inputZip = await window.JSZip.loadAsync(ipaBytes);
            }

            // 1. Apply plist modifications
            if (originalPlistData && isLocalServerAvailable) {
                updateProgress(30, window.t("修改参数...", "Modifying plist..."), window.t("正在重新编译并写入 Info.plist...", "Recompiling and writing Info.plist..."));
                await applyPlistModifications();
            }

            // 2. Custom Icon replacement
            if (customIconFile) {
                updateProgress(50, window.t("更换图标...", "Replacing icon..."), window.t("正在应用个性化应用图标...", "Applying custom app icon..."));
                const iconRegex = /Payload\/[^/]+\.app\/(?:AppIcon|Icon|icon|App-Icon)[^/]*\.png$/i;
                const matchingIcons = Object.keys(inputZip.files).filter(name => iconRegex.test(name));
                
                if (matchingIcons.length > 0) {
                    const iconBytes = await readFileAsArrayBuffer(customIconFile);
                    for (const iconPath of matchingIcons) {
                        inputZip.file(iconPath, iconBytes);
                    }
                } else {
                    const appFolder = Object.keys(inputZip.files).find(name => name.startsWith('Payload/') && name.endsWith('.app/'));
                    if (appFolder) {
                        const iconBytes = await readFileAsArrayBuffer(customIconFile);
                        inputZip.file(`${appFolder}AppIcon60x60@2x.png`, iconBytes);
                        inputZip.file(`${appFolder}AppIcon60x60@3x.png`, iconBytes);
                    }
                }
            }

            // 3. Dylib Injection
            if (customDylibFile) {
                updateProgress(70, window.t("注入动态库...", "Injecting dylib..."), window.t("正在注入动态库到二进制中...", "Injecting dynamic library..."));
                let executableName = '';
                const appFolder = Object.keys(inputZip.files).find(name => name.startsWith('Payload/') && name.endsWith('.app/'));
                if (appFolder) {
                    const folderBaseName = appFolder.substring(appFolder.indexOf('/') + 1, appFolder.lastIndexOf('.app/'));
                    const exePath = `${appFolder}${folderBaseName}`;
                    if (inputZip.files[exePath]) {
                        executableName = exePath;
                    }
                }

                if (executableName && inputZip.files[executableName]) {
                    const exeBytes = await inputZip.files[executableName].async('uint8array');
                    const dylibName = customDylibFile.name;
                    const dylibPath = `@executable_path/Frameworks/${dylibName}`;
                    
                    const patchedBytes = injectDylibToMacho(exeBytes, dylibPath);
                    if (patchedBytes) {
                        inputZip.file(executableName, patchedBytes);
                        
                        const dylibBytes = await readFileAsArrayBuffer(customDylibFile);
                        inputZip.file(`${appFolder}Frameworks/${dylibName}`, dylibBytes);
                    }
                }
            }

            // 4. Generate new ZIP
            updateProgress(85, window.t("重新打包...", "Packaging..."), window.t("正在打包生成定制的未签名 IPA 文件...", "Packaging custom unsigned IPA file..."));
            const signedBytes = await inputZip.generateAsync({
                type: 'uint8array',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 }
            });

            // 5. Download
            updateProgress(100, window.t("导出成功！", "Export Success!"), window.t("已生成定制的未签名 IPA，开始下载...", "Customized unsigned IPA created. Downloading..."));
            
            const originalName = files.ipa.name.replace(/\.ipa$/, '');
            const outputFileName = `${originalName}_customized.ipa`;
            const blob = new Blob([signedBytes], { type: 'application/octet-stream' });
            
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = outputFileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            if (btn) btn.disabled = false;
        } catch (err) {
            updateProgress(0, window.t("导出失败！", "Export Failed!"), window.t(`错误信息: ${err.message}`, `Error: ${err.message}`));
            logToConsole(`[ERROR] Export failed: ${err.message}`);
            if (btn) btn.disabled = false;
        }
    }

    async function checkCompanionServer() {
        try {
            const response = await fetch('/api/parse-plist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: new Uint8Array()
            });
            isLocalServerAvailable = true;
            updatePlistStatus(false, window.t("本地服务已就绪 (等待导入 IPA)", "Local Server Ready (Waiting for IPA)"));
        } catch (e) {
            isLocalServerAvailable = false;
            updatePlistStatus(false, window.t("未运行本地服务 (不可修改参数)", "Local Server Offline"));
        }
    }

    // Helper: Mach-O Dynamic Library Injector
    function injectDylibToMacho(machoBytes, dylibPath) {
        const view = new DataView(machoBytes.buffer, machoBytes.byteOffset, machoBytes.byteLength);
        const magic = view.getUint32(0, true);
        
        if (magic === 0xfeedfacf) {
            return injectIntoSingleMacho(machoBytes, dylibPath);
        } else if (magic === 0xcafebabe || magic === 0xbebafeca) {
            const isBigEndian = magic === 0xcafebabe;
            const numArchitectures = view.getUint32(4, !isBigEndian);
            
            for (let i = 0; i < numArchitectures; i++) {
                const offset = 8 + i * 20;
                const archOffset = view.getUint32(offset + 8, !isBigEndian);
                const archSize = view.getUint32(offset + 12, !isBigEndian);
                
                const subBytes = new Uint8Array(machoBytes.buffer, machoBytes.byteOffset + archOffset, archSize);
                const result = injectIntoSingleMacho(subBytes, dylibPath);
                if (!result) return null;
            }
            return machoBytes;
        } else {
            console.warn("Unknown Mach-O magic:", magic.toString(16));
            return null;
        }
    }

    function injectIntoSingleMacho(machoBytes, dylibPath) {
        const view = new DataView(machoBytes.buffer, machoBytes.byteOffset, machoBytes.byteLength);
        const magic = view.getUint32(0, true);
        const is64 = magic === 0xfeedfacf || magic === 0xcffacfde;
        const isBig = magic === 0xcffacfde || magic === 0xfeedface;
        const isLittle = !isBig;

        const headerSize = is64 ? 32 : 28;
        let ncmds = view.getUint32(16, isLittle);
        let sizeofcmds = view.getUint32(20, isLittle);
        const endOfCmds = headerSize + sizeofcmds;
        
        const cmdType = 0x18 | 0x80000000; // LC_LOAD_WEAK_DYLIB
        const align = is64 ? 8 : 4;
        const pathBytes = new TextEncoder().encode(dylibPath);
        const pathLen = pathBytes.length + 1;
        
        const cmdStructSize = 24;
        const cmdSize = Math.ceil((cmdStructSize + pathLen) / align) * align;
        
        if (endOfCmds + cmdSize > machoBytes.length) {
            console.error("Binary too small for injection.");
            return null;
        }
        
        for (let i = 0; i < cmdSize; i++) {
            if (machoBytes[endOfCmds + i] !== 0) {
                console.error("Not enough padding in Mach-O header to inject load command.");
                return null;
            }
        }
        
        const cmdView = new DataView(machoBytes.buffer, machoBytes.byteOffset + endOfCmds, cmdSize);
        cmdView.setUint32(0, cmdType, isLittle);
        cmdView.setUint32(4, cmdSize, isLittle);
        cmdView.setUint32(8, 24, isLittle);
        cmdView.setUint32(12, 2, isLittle);
        cmdView.setUint32(16, 0, isLittle);
        cmdView.setUint32(20, 0, isLittle);
        
        const stringOffset = endOfCmds + cmdStructSize;
        machoBytes.set(pathBytes, stringOffset);
        machoBytes[stringOffset + pathBytes.length] = 0;
        
        for (let i = cmdStructSize + pathLen; i < cmdSize; i++) {
            machoBytes[endOfCmds + i] = 0;
        }
        
        view.setUint32(16, ncmds + 1, isLittle);
        view.setUint32(20, sizeofcmds + cmdSize, isLittle);
        return machoBytes;
    }

    // Helper: ZIP loader and file tree renderer
    async function loadIpaZip(file) {
        try {
            logToConsole(window.t("正在本地预读取分析 IPA 文件结构...", "Preloading and analyzing IPA package structure..."));
            const arrayBuffer = await readFileAsArrayBuffer(file);
            ipaZipInstance = await window.JSZip.loadAsync(arrayBuffer);
            logToConsole(window.t("IPA 解析成功！已提取内部文件映射关系。", "IPA loaded successfully! File mappings resolved."));
            
            // Try to locate Info.plist
            const appFolder = Object.keys(ipaZipInstance.files).find(name => name.startsWith('Payload/') && name.endsWith('.app/'));
            if (appFolder) {
                plistPathInZip = `${appFolder}Info.plist`;
                const plistEntry = ipaZipInstance.files[plistPathInZip];
                if (plistEntry) {
                    logToConsole(window.t("发现 Info.plist 配置文件，正在尝试解析参数...", "Located Info.plist, attempting to parse app config..."));
                    const plistBytes = await plistEntry.async('uint8array');
                    await parseInfoPlist(plistBytes);
                } else {
                    logToConsole(window.t("[警告] 未能在 .app 目录中找到 Info.plist 配置文件！", "[Warning] Info.plist not found in .app directory!"));
                    updatePlistStatus(false, window.t("未找到 Info.plist", "Info.plist not found"));
                }
            } else {
                updatePlistStatus(false, window.t("未定位到 App 目录", "App folder not found"));
            }

            await renderFileExplorer();

            // Show save/export button
            const saveBtn = document.getElementById('btn-ipa-save-export');
            if (saveBtn) saveBtn.style.display = 'block';

        } catch (err) {
            logToConsole(`[ERROR] Failed to load zip: ${err.message}`);
            console.error(err);
        }
    }

    async function renderFileExplorer() {
        const tbody = document.getElementById('ipa-explorer-tbody');
        const panel = document.getElementById('ipa-explorer-panel');
        if (!tbody || !panel) return;

        if (!ipaZipInstance) {
            panel.style.display = 'none';
            tbody.innerHTML = '';
            return;
        }

        panel.style.display = 'block';
        tbody.innerHTML = '';

        const fileNames = Object.keys(ipaZipInstance.files);
        fileNames.sort();

        // Filter files to show only direct files inside the .app or Frameworks folder, plus config plists
        const appRegex = /^Payload\/[^/]+\.app\/[^/]+$/;
        const frameworkRegex = /^Payload\/[^/]+\.app\/Frameworks\/[^/]+$/;
        const plistRegex = /\.plist$/i;
        const dylibRegex = /\.dylib$/i;

        const filteredFiles = fileNames.filter(name => {
            const isDir = ipaZipInstance.files[name].dir;
            if (isDir) return false;
            
            return appRegex.test(name) || 
                   frameworkRegex.test(name) || 
                   plistRegex.test(name) || 
                   dylibRegex.test(name);
        });

        if (filteredFiles.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 15px; color: var(--text-secondary);">No relevant files found</td></tr>`;
            return;
        }

        for (const name of filteredFiles) {
            const entry = ipaZipInstance.files[name];
            const sizeBytes = entry._data ? (entry._data.uncompressedSize || 0) : 0;
            const sizeStr = formatBytes(sizeBytes);
            
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
            
            tr.innerHTML = `
                <td style="padding: 10px 16px; font-family: monospace; word-break: break-all; color: var(--text-primary);">${name}</td>
                <td style="padding: 10px 16px; color: var(--text-secondary);">${sizeStr}</td>
                <td style="padding: 10px 16px; text-align: center; display: flex; gap: 8px; justify-content: center; align-items: center;">
                    <button type="button" class="btn btn-secondary btn-download" style="padding: 4px 8px; font-size: 11px; min-height: 24px; border-color: rgba(255,255,255,0.1);">📥</button>
                    <button type="button" class="btn btn-secondary btn-delete" style="padding: 4px 8px; font-size: 11px; min-height: 24px; color: #EF4444; border-color: rgba(239, 68, 68, 0.2);">🗑️</button>
                </td>
            `;

            tr.querySelector('.btn-download').addEventListener('click', async () => {
                try {
                    const data = await entry.async('blob');
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(data);
                    link.download = name.substring(name.lastIndexOf('/') + 1);
                    link.click();
                } catch (err) {
                    alert("Failed to download file: " + err.message);
                }
            });

            tr.querySelector('.btn-delete').addEventListener('click', () => {
                if (confirm(window.t(`确定要删除此文件吗？此操作将立即修改内存中的 IPA 包数据。\n\n路径：${name}`, `Are you sure you want to delete this file? This will immediately modify the IPA package in memory.\n\nPath: ${name}`))) {
                    delete ipaZipInstance.files[name];
                    tr.remove();
                    logToConsole(window.t(`已从 IPA 包中删除文件: ${name}`, `Deleted file from IPA package: ${name}`));
                }
            });

            tbody.appendChild(tr);
        }
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function setupDylibUploader() {
        const box = document.getElementById('dylib-upload-box');
        const input = document.getElementById('ipa-dylib-input');
        const info = document.getElementById('dylib-file-info');
        const placeholder = document.getElementById('dylib-upload-placeholder');

        if (!box || !input || !info) return;

        const clearBtn = info.querySelector('.btn-clear-file');

        box.addEventListener('click', () => {
            input.click();
        });

        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                handleDylibFile(file);
            }
        });

        box.addEventListener('dragover', (e) => {
            e.preventDefault();
            box.style.borderColor = 'var(--primary-light)';
            box.style.background = 'rgba(139, 92, 246, 0.05)';
        });

        box.addEventListener('dragleave', () => {
            box.style.borderColor = 'var(--border-color)';
            box.style.background = 'rgba(255, 255, 255, 0.01)';
        });

        box.addEventListener('drop', (e) => {
            e.preventDefault();
            box.style.borderColor = 'var(--border-color)';
            box.style.background = 'rgba(255, 255, 255, 0.01)';
            const file = e.dataTransfer.files[0];
            if (file && file.name.endsWith('.dylib')) {
                handleDylibFile(file);
            } else {
                alert(window.t("只能注入 .dylib 格式的动态库插件！", "Only .dylib dynamic libraries can be injected!"));
            }
        });

        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                customDylibFile = null;
                input.value = '';
                info.style.display = 'none';
                placeholder.style.display = 'flex';
            });
        }

        function handleDylibFile(file) {
            customDylibFile = file;
            placeholder.style.display = 'none';
            info.style.display = 'flex';
            
            const nameText = info.querySelector('.file-name-text');
            if (nameText) {
                const sizeKB = (file.size / 1024).toFixed(1);
                const sizeStr = sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;
                nameText.textContent = `${file.name} (${sizeStr})`;
            }
            logToConsole(window.t(`选定待注入的动态库: ${file.name}`, `Selected dylib for injection: ${file.name}`));
        }
    }

    // Global initializer called on page load or routing switch
    window.initIpaSigner = function () {
        try {
            // Setup all dropzones
            setupDropzone('p12-upload-box', 'ipa-p12-input', 'p12-file-info', '.p12', 'p12');
            setupDropzone('prov-upload-box', 'ipa-prov-input', 'prov-file-info', '.mobileprovision', 'prov');
            setupDropzone('ent-upload-box', 'ipa-ent-input', 'ent-file-info', '.plist', 'ent');
            setupDropzone('ipa-upload-box', 'ipa-file-input', 'ipa-file-info', '.ipa', 'ipa');

        // Setup direct install dropzone, icon uploader, dylib uploader, & tabs
        setupDirectDropzone();
        setupIconUploader();
        setupDylibUploader();
        setupTabs();

        // Password visibility toggle
        const passInput = document.getElementById('ipa-password-input');
        const passToggle = document.getElementById('ipa-password-toggle');
        if (passInput && passToggle) {
            passToggle.outerHTML = passToggle.outerHTML; 
            const newPassToggle = document.getElementById('ipa-password-toggle');
            newPassToggle.addEventListener('click', () => {
                if (passInput.type === 'password') {
                    passInput.type = 'text';
                    newPassToggle.textContent = '🙈';
                } else {
                    passInput.type = 'password';
                    newPassToggle.textContent = '👁️';
                }
            });
        }

        // Accordion settings toggle
        const settingsHeader = document.getElementById('ipa-settings-header');
        const settingsContent = document.getElementById('ipa-settings-content');
        const settingsArrow = document.getElementById('ipa-settings-arrow');
        if (settingsHeader && settingsContent && settingsArrow) {
            settingsHeader.outerHTML = settingsHeader.outerHTML;
            const newSettingsHeader = document.getElementById('ipa-settings-header');
            newSettingsHeader.addEventListener('click', () => {
                const isOpen = settingsContent.style.display === 'flex';
                if (isOpen) {
                    settingsContent.style.display = 'none';
                    settingsArrow.style.transform = 'rotate(0deg)';
                } else {
                    settingsContent.style.display = 'flex';
                    settingsArrow.style.transform = 'rotate(180deg)';
                }
            });
        }

        // Sign Button binding
        const signBtn = document.getElementById('btn-ipa-sign');
        if (signBtn) {
            signBtn.outerHTML = signBtn.outerHTML;
            const newSignBtn = document.getElementById('btn-ipa-sign');
            newSignBtn.addEventListener('click', startSigning);
        }

        // Reset Button binding
        const resetBtn = document.getElementById('btn-ipa-reset');
        if (resetBtn) {
            resetBtn.outerHTML = resetBtn.outerHTML;
            const newResetBtn = document.getElementById('btn-ipa-reset');
            newResetBtn.addEventListener('click', resetSigner);
        }

        // Direct Install Button binding
        const directInstallBtn = document.getElementById('btn-ipa-direct-install');
        if (directInstallBtn) {
            directInstallBtn.outerHTML = directInstallBtn.outerHTML;
            const newDirectInstallBtn = document.getElementById('btn-ipa-direct-install');
            newDirectInstallBtn.addEventListener('click', startDirectInstall);
        }

        // Wifi Install Button binding (for sign & install flow)
        const wifiInstallBtn = document.getElementById('btn-ipa-wifi-install');
        if (wifiInstallBtn) {
            wifiInstallBtn.outerHTML = wifiInstallBtn.outerHTML;
            const newWifiInstallBtn = document.getElementById('btn-ipa-wifi-install');
            newWifiInstallBtn.addEventListener('click', () => {
                if (lastSignedBlob) {
                    uploadAndInstall(lastSignedBlob, lastSignedName, lastSignedBundleId);
                }
            });
        }

        // Bypass Min OS version binding
        const bypassMinOsBtn = document.getElementById('btn-ipa-bypass-min-os');
        if (bypassMinOsBtn) {
            bypassMinOsBtn.outerHTML = bypassMinOsBtn.outerHTML;
            const newBypassBtn = document.getElementById('btn-ipa-bypass-min-os');
            newBypassBtn.addEventListener('click', () => {
                const minOsInput = document.getElementById('ipa-new-min-os');
                if (minOsInput) {
                    minOsInput.value = '12.0';
                    logToConsole(window.t("已将最低 iOS 系统要求降级设置为 12.0", "Minimum iOS version requirement set to 12.0"));
                }
            });
        }

        // Save & Export Button binding
        const saveExportBtn = document.getElementById('btn-ipa-save-export');
        if (saveExportBtn) {
            saveExportBtn.outerHTML = saveExportBtn.outerHTML;
            const newSaveExportBtn = document.getElementById('btn-ipa-save-export');
            newSaveExportBtn.addEventListener('click', saveAndExportIPA);
        }

        // Check companion server connection
        checkCompanionServer().catch(() => {});
        } catch (initErr) {
            console.error("Error during initIpaSigner:", initErr);
            logToConsole(`[INIT ERROR] Initialization failed: ${initErr.message}`);
        }
    };
})();
