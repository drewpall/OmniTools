/*

 * OmniTools - Email Bulk Sender & Mail Merge Tool

 * 100% Client-side MSAL integration with Microsoft Graph API and CSV mail merging.

 */



(function() {

    let msalInstance = null;

    let isInitialized = false;



    // Queue State

    let isSending = false;

    let isPaused = false;

    let queue = [];

    let queueIndex = 0;

    let sendTimer = null;

    let emailKey = "";

    

    let subjectTemplate = "";

    let bodyTemplate = "";

    let contentType = "HTML";



    let stats = { total: 0, pending: 0, success: 0, failed: 0 };

    let currentEngine = 'msal';



    // Translation helper

    function t(zh, en) {

        const isEn = document.body.classList.contains('lang-en');

        return isEn ? en : zh;

    }



    const $ = (id) => document.getElementById(id);



    // Dynamic logging console helper

    function logToConsole(message) {

        const consoleEl = $('email-console');

        if (!consoleEl) return;

        const now = new Date();

        const timeString = now.toTimeString().split(' ')[0];

        consoleEl.textContent += `\n[${timeString}] ${message}`;

        consoleEl.scrollTop = consoleEl.scrollHeight;

    }



    // Custom fetch with timeout helper

    async function fetchWithTimeout(resource, options = {}) {

        const { timeout = 6000 } = options;

        const controller = new AbortController();

        const id = setTimeout(() => controller.abort(), timeout);

        try {

            const response = await fetch(resource, {

                ...options,

                signal: controller.signal

            });

            clearTimeout(id);

            return response;

        } catch (err) {

            clearTimeout(id);

            throw err;

        }

    }



    // Initializer

    window.initEmailSender = async function() {

        if (isInitialized) return;

        isInitialized = true;



        // Display current Redirect URI to help users register in Azure

        const currentRedirectUri = window.location.origin + window.location.pathname;

        $('email-redirect-uri').textContent = currentRedirectUri;



        // Restore custom Client ID from localStorage

        const defaultClientId = "cf5354e1-2db7-48f8-a3d5-e9df640003b5";

        const savedClientId = localStorage.getItem('email_client_id') || "";

        $('email-client-id-input').value = savedClientId;



        // Bind events

        bindEvents();



        // Initialize MSAL with active Client ID

        const activeClientId = savedClientId || defaultClientId;

        await initializeMsalInstance(activeClientId);

    };



    async function initializeMsalInstance(clientId) {

        if (!window.msal) {

            logToConsole(t('❌ 微软 MSAL 库未加载，请刷新页面或检查网络。', '❌ MSAL library not loaded. Refresh or check network.'));

            return;

        }



        const msalConfig = {

            auth: {

                clientId: clientId,

                authority: "https://login.microsoftonline.com/common",

                redirectUri: window.location.origin + window.location.pathname

            },

            cache: {

                cacheLocation: "sessionStorage",

                storeAuthStateInCookie: false

            }

        };



        try {

            msalInstance = new msal.PublicClientApplication(msalConfig);

            await msalInstance.initialize();

            

            // Check if user is already logged in

            const activeAccount = getActiveAccount();

            if (activeAccount) {

                updateAuthUI(activeAccount);

            } else {

                updateAuthUI(null);

            }

        } catch (err) {

            logToConsole(t('❌ 微软 MSAL 初始化失败: ', '❌ MSAL Init failed: ') + err.message);

        }

    }



    function getActiveAccount() {

        if (!msalInstance) return null;

        const accounts = msalInstance.getAllAccounts();

        if (accounts.length > 0) return accounts[0];

        return null;

    }



    function updateAuthUI(account) {

        const loginBtn = $('email-btn-login');

        const logoutBtn = $('email-btn-logout');

        const statusEl = $('email-auth-status');

        const startBtn = $('email-btn-start');



        if (account) {

            loginBtn.style.display = 'none';

            logoutBtn.style.display = 'flex';

            statusEl.innerHTML = `<span style="color: #10B981; font-weight: 600;">✅ ${t('已连接', 'Connected')}: ${account.username}</span>`;

            if (queue.length > 0) {

                startBtn.disabled = false;

            }

        } else {

            loginBtn.style.display = 'flex';

            logoutBtn.style.display = 'none';

            statusEl.innerHTML = `<span style="color: #F59E0B;">⚠️ ${t('未连接。请登录你的 Outlook/Office365 账号。', 'Not connected. Log in to Outlook/Office365.')}</span>`;

            startBtn.disabled = true;

        }

    }



    function bindEvents() {

        // Login & Logout

        $('email-btn-login').addEventListener('click', login);

        $('email-btn-logout').addEventListener('click', logout);



        // Custom Client ID input update

        $('email-client-id-input').addEventListener('change', async (e) => {

            const val = e.target.value.trim();

            if (val) {

                localStorage.setItem('email_client_id', val);

            } else {

                localStorage.removeItem('email_client_id');

            }

            logToConsole(t('🔄 Client ID 已更改，重新初始化 Microsoft MSAL...', '🔄 Client ID updated, reinitializing MSAL...'));

            const defaultClientId = "cf5354e1-2db7-48f8-a3d5-e9df640003b5";

            await initializeMsalInstance(val || defaultClientId);

        });



        // Parse CSV Button

        $('email-btn-parse').addEventListener('click', handleParseData);



        // Delay slider

        $('email-delay-slider').addEventListener('input', (e) => {

            $('email-delay-val').textContent = `${e.target.value}s`;

        });



        // Queue Control Buttons

        $('email-btn-start').addEventListener('click', startSending);

        $('email-btn-pause').addEventListener('click', pauseSending);

        $('email-btn-stop').addEventListener('click', stopSending);



        // Access Token input bypass
        $('email-manual-token-input').addEventListener('input', () => {
            const token = $('email-manual-token-input').value.trim();
            const startBtn = $('email-btn-start');
            const statusEl = $('email-auth-status');
            if (token) {
                startBtn.disabled = false;
                statusEl.innerHTML = `<span style="color: #10B981; font-weight: 600;">🎟️ ${t('已使用手动 Access Token 登录', 'Connected via Manual Access Token')}</span>`;
            } else {
                const account = getActiveAccount();
                updateAuthUI(account);
            }
        });

        // Manual add single recipient email
        $('email-btn-add-single').addEventListener('click', () => {
            const singleEmail = $('email-single-recipient').value.trim();
            if (!singleEmail || !singleEmail.includes('@')) {
                alert(t('请输入有效的收件人邮箱！', 'Please enter a valid recipient email address!'));
                return;
            }

            // Init emailKey if not set
            if (!emailKey) {
                emailKey = 'email';
            }

            const newRow = {};
            newRow[emailKey] = singleEmail;
            
            queue.push(newRow);
            $('email-single-recipient').value = '';
            
            // Re-render preview UI
            renderRecipientPreview(['email']);
            logToConsole(t(`➕ 手动添加收件人: ${singleEmail}，当前共有 ${queue.length} 个收件人。`, `➕ Manually added recipient: ${singleEmail}. Total: ${queue.length}`));
        });

        // Dual-Engine Tabs Switch
        $('email-tab-msal').addEventListener('click', () => switchEngine('msal'));
        $('email-tab-smtp').addEventListener('click', () => switchEngine('smtp'));
        
        // SMTP Form Inputs Validation
        $('email-smtp-user').addEventListener('input', validateSmtpForm);
        $('email-smtp-pass').addEventListener('input', validateSmtpForm);
        $('email-smtp-host').addEventListener('input', validateSmtpForm);
        $('email-smtp-port').addEventListener('input', validateSmtpForm);

        // SMTP Auto-completion helper
        $('email-smtp-user').addEventListener('blur', (e) => {
            const val = e.target.value.trim().toLowerCase();
            const hostInput = $('email-smtp-host');
            const portInput = $('email-smtp-port');
            const secureInput = $('email-smtp-secure');

            if (!hostInput.value) {
                if (val.endsWith('@qq.com')) {
                    hostInput.value = 'smtp.qq.com';
                    portInput.value = '465';
                    secureInput.checked = true;
                } else if (val.endsWith('@163.com')) {
                    hostInput.value = 'smtp.163.com';
                    portInput.value = '465';
                    secureInput.checked = true;
                } else if (val.endsWith('@126.com')) {
                    hostInput.value = 'smtp.126.com';
                    portInput.value = '465';
                    secureInput.checked = true;
                } else if (val.endsWith('@gmail.com')) {
                    hostInput.value = 'smtp.gmail.com';
                    portInput.value = '465';
                    secureInput.checked = true;
                } else if (val.endsWith('@outlook.com') || val.endsWith('@hotmail.com')) {
                    hostInput.value = 'smtp-mail.outlook.com';
                    portInput.value = '587';
                    secureInput.checked = false;
                }
            }
            validateSmtpForm();
        });

        // Clear log console

        $('email-btn-clear-logs').addEventListener('click', () => {

            $('email-console').textContent = t('[已清空日志控制台]', '[Console log cleared]');

        });

    }



    async function login() {

        if (!msalInstance) return;

        const loginRequest = {

            scopes: ["User.Read", "Mail.Send"]

        };

        try {

            const response = await msalInstance.loginPopup(loginRequest);

            updateAuthUI(response.account);

            logToConsole(t('🔓 成功登录账户: ' + response.account.username, '🔓 Successfully logged in: ' + response.account.username));

        } catch (err) {

            logToConsole(t('❌ 登录失败: ' + err.message, '❌ Login failed: ' + err.message));

        }

    }



    async function logout() {

        if (!msalInstance) return;

        try {

            await msalInstance.logoutPopup();

            updateAuthUI(null);

            logToConsole(t('🚪 账户已安全退出登录。', '🚪 Successfully logged out.'));

        } catch (err) {

            logToConsole(t('❌ 退出登录失败: ' + err.message, '❌ Logout failed: ' + err.message));

        }

    }



    async function getAccessToken() {
        const manualToken = $('email-manual-token-input').value.trim();
        if (manualToken) {
            return manualToken;
        }

        const account = getActiveAccount();

        if (!account) return null;

        

        const tokenRequest = {

            scopes: ["Mail.Send"],

            account: account

        };



        try {

            const response = await msalInstance.acquireTokenSilent(tokenRequest);

            return response.accessToken;

        } catch (err) {

            console.warn("Silent token request failed, trying popup", err);

            try {

                const response = await msalInstance.acquireTokenPopup(tokenRequest);

                return response.accessToken;

            } catch (e) {

                console.error("Popup token request failed", e);

                return null;

            }

        }

    }



    // Parse pasted CSV data

    function handleParseData() {

        const text = $('email-recipients-paste').value.trim();

        if (!text) {

            alert(t('请输入收件人数据！', 'Please enter recipient data!'));

            return;

        }



        const result = parseCSV(text);

        if (!result) {

            alert(t('解析数据失败，请检查 CSV 格式！', 'Data parsing failed. Check CSV format.'));

            return;

        }



        // Find Email column

        const headers = result.headers;

        emailKey = headers.map(h => h.toLowerCase()).find(h => h === 'email' || h === '邮箱' || h === 'mail');

        

        if (!emailKey) {

            alert(t("未找到包含 'email' 或 '邮箱' 的表头！请检查第一行表头格式。", "No 'email' or '邮箱' column found in header!"));

            return;

        }



        queue = result.data;

        logToConsole(t(`📊 成功解析 ${queue.length} 行数据，提取到表头: `, `📊 Parsed ${queue.length} rows. Headers: `) + headers.join(', '));



        // Render parameter tag guide list

        const tagsContainer = $('email-tags-list');

        tagsContainer.innerHTML = '';

        headers.forEach(h => {

            const span = document.createElement('span');

            span.className = 'email-tag';

            span.textContent = `{${h}}`;

            span.title = t('点击插入到正文', 'Click to insert into body');

            span.addEventListener('click', () => {

                const bodyInput = $('email-body-input');

                const start = bodyInput.selectionStart;

                const end = bodyInput.selectionEnd;

                const bodyText = bodyInput.value;

                bodyInput.value = bodyText.substring(0, start) + `{${h}}` + bodyText.substring(end);

                bodyInput.focus();

            });

            tagsContainer.appendChild(span);

        });



        renderRecipientPreview(headers);
    }

    function renderRecipientPreview(headers) {
        // Render preview table
        const table = $('email-preview-table');
        table.innerHTML = '';
        
        // Headers
        const trHead = document.createElement('tr');
        headers.forEach(h => {
            const th = document.createElement('th');
            th.textContent = h;
            trHead.appendChild(th);
        });
        // Status column header
        const thStatus = document.createElement('th');
        thStatus.textContent = t('状态', 'Status');
        trHead.appendChild(thStatus);
        table.appendChild(trHead);

        // Data Rows preview
        queue.forEach((row, rowIndex) => {
            const tr = document.createElement('tr');
            tr.id = `email-row-${rowIndex}`;
            headers.forEach(h => {
                const td = document.createElement('td');
                td.textContent = row[h.toLowerCase()] || '';
                tr.appendChild(td);
            });
            const tdStatus = document.createElement('td');
            tdStatus.id = `email-status-${rowIndex}`;
            tdStatus.textContent = t('等待中 / Ready', 'Ready');
            tdStatus.style.opacity = '0.5';
            tr.appendChild(tdStatus);
            table.appendChild(tr);
        });

        $('email-recipients-preview-container').style.display = 'block';

        // Update stats
        stats = { total: queue.length, pending: queue.length, success: 0, failed: 0 };
        updateStatsCounters();



        // Enable Start button if logged in or using SMTP
        if (currentEngine === 'smtp') {
            validateSmtpForm();
        } else if (getActiveAccount() || $('email-manual-token-input').value.trim()) {
            $('email-btn-start').disabled = false;
        }
    }



    function parseCSV(text) {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length === 0) return null;

        // Auto check: if first line is a valid email (or doesn't contain common CSV headers),
        // we can assume it's just a raw list of emails.
        const looksLikeEmail = (str) => {
            return str.includes('@') && str.includes('.');
        };

        const firstLine = lines[0];
        const firstLineCols = parseCSVLine(firstLine);
        
        let hasHeader = false;
        // If there's an email/邮箱/mail in the first line columns, we treat it as header.
        // Otherwise, if any of the columns look like an email address, or there is only 1 line, or no header keyword is matched, we assume NO header.
        const hasHeaderKeywords = firstLineCols.some(col => {
            const low = col.toLowerCase();
            return low === 'email' || low === '邮箱' || low === 'mail';
        });

        if (hasHeaderKeywords) {
            hasHeader = true;
        }

        let headers = [];
        let startIdx = 0;

        if (hasHeader) {
            headers = firstLineCols;
            startIdx = 1;
        } else {
            // Check if there is only one column or it looks like a list of emails
            // Create a default header
            const maxCols = Math.max(...lines.map(l => parseCSVLine(l).length));
            if (maxCols === 1) {
                headers = ['email'];
            } else {
                headers = [];
                for (let c = 0; c < maxCols; c++) {
                    // Make the first one email if it looks like email, or if it's the first column
                    if (c === 0) {
                        headers.push('email');
                    } else {
                        headers.push(`param${c}`);
                    }
                }
            }
            startIdx = 0;
        }

        const data = [];
        for (let i = startIdx; i < lines.length; i++) {
            const row = parseCSVLine(lines[i]);
            if (row.length === 0) continue;
            const entry = {};
            headers.forEach((h, index) => {
                entry[h.toLowerCase()] = row[index] || '';
            });
            data.push(entry);
        }
        return { headers, data };
    }



    function parseCSVLine(line) {

        const result = [];

        let current = '';

        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {

            const char = line[i];

            if (char === '"') {

                inQuotes = !inQuotes;

            } else if (char === ',' && !inQuotes) {

                result.push(current.trim());

                current = '';

            } else {

                current += char;

            }

        }

        result.push(current.trim());

        return result.map(v => v.replace(/^"|"$/g, ''));

    }



    function renderTemplate(template, row) {
        let result = template;
        for (const key in row) {
            const escapedKey = key.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp('\\{' + escapedKey + '\\}', 'gi');
            result = result.replace(regex, row[key]);
        }
        return result;
    }

    function updateStatsCounters() {

        $('email-count-total').textContent = stats.total;

        $('email-count-pending').textContent = stats.pending;

        $('email-count-success').textContent = stats.success;

        $('email-count-failed').textContent = stats.failed;

    }



    function updateTableRowStatus(index, status) {

        const td = $(`email-status-${index}`);

        const tr = $(`email-row-${index}`);

        if (!td) return;

        

        if (status === 'sending') {

            td.textContent = t('⚡ 发送中...', '⚡ Sending...');

            td.style.color = 'var(--accent-blue)';

            td.style.opacity = '1';

        } else if (status === 'success') {

            td.textContent = t('✅ 成功 / Sent', '✅ Sent');

            td.style.color = '#10B981';

            td.style.opacity = '1';

            if (tr) tr.style.background = 'rgba(16, 185, 129, 0.05)';

        } else if (status === 'failed') {

            td.textContent = t('❌ 失败 / Fail', '❌ Fail');

            td.style.color = '#EF4444';

            td.style.opacity = '1';

            if (tr) tr.style.background = 'rgba(239, 68, 68, 0.05)';

        } else {

            td.textContent = t('等待中 / Ready', 'Ready');

            td.style.color = 'var(--text-primary)';

            td.style.opacity = '0.5';

        }

    }



    // Queue Schedulers

    function startSending() {

        subjectTemplate = $('email-subject-input').value.trim();

        bodyTemplate = $('email-body-input').value.trim();

        contentType = $('email-type-select').value;



        if (!subjectTemplate || !bodyTemplate) {

            alert(t('请填写邮件主题和邮件正文模板！', 'Please fill email subject and body template!'));

            return;

        }



        if (queue.length === 0) {

            alert(t('没有收件人数据可供发送，请先导入并解析！', 'No recipients data. Import and parse first.'));

            return;

        }



        isSending = true;

        isPaused = false;

        

        $('email-btn-start').style.display = 'none';

        $('email-btn-pause').style.display = 'flex';

        $('email-btn-stop').style.display = 'flex';

        $('email-status-badge').textContent = t('正在发送 / Sending', 'Sending');

        $('email-status-badge').style.background = 'rgba(59, 130, 246, 0.15)';

        $('email-status-badge').style.color = 'var(--accent-blue)';

        

        logToConsole(t('🚀 启动合并群发任务调度队列...', '🚀 Launching bulk send schedule queue...'));

        

        processQueue();

    }



    function pauseSending() {

        isPaused = true;

        clearTimeout(sendTimer);

        

        $('email-btn-pause').style.display = 'none';

        $('email-btn-start').style.display = 'flex';

        $('email-btn-start').disabled = false;

        

        $('email-status-badge').textContent = t('已暂停 / Paused', 'Paused');

        $('email-status-badge').style.background = 'rgba(245, 158, 11, 0.15)';

        $('email-status-badge').style.color = '#F59E0B';

        

        logToConsole(t('⏸️ 队列发送已由用户暂停。', '⏸️ Queue send paused by user.'));

    }



    function stopSending() {

        isSending = false;

        isPaused = false;

        clearTimeout(sendTimer);

        

        queueIndex = 0;

        

        // Reset row UI

        queue.forEach((_, index) => {

            updateTableRowStatus(index, 'ready');

        });



        stats = { total: queue.length, pending: queue.length, success: 0, failed: 0 };

        updateStatsCounters();



        $('email-btn-pause').style.display = 'none';

        $('email-btn-stop').style.display = 'none';

        $('email-btn-start').style.display = 'flex';

        $('email-btn-start').disabled = false;



        $('email-status-badge').textContent = t('Ready', 'Ready');

        $('email-status-badge').style.background = 'rgba(255,255,255,0.05)';

        $('email-status-badge').style.color = 'var(--text-primary)';

        

        logToConsole(t('🛑 队列发送已重置。', '🛑 Queue send reset.'));

    }



    async function processQueue() {
        if (!isSending || isPaused) return;

        if (queueIndex >= queue.length) {
            isSending = false;
            $('email-btn-pause').style.display = 'none';
            $('email-btn-stop').style.display = 'none';
            $('email-btn-start').style.display = 'flex';
            
            $('email-status-badge').textContent = t('已完成 / Finished', 'Finished');
            $('email-status-badge').style.background = 'rgba(16, 185, 129, 0.15)';
            $('email-status-badge').style.color = '#10B981';

            logToConsole(t('🎉 所有邮件群发任务已完成！', '🎉 All bulk email tasks completed!'));
            alert(t('所有邮件发送任务已完成！', 'All email tasks completed!'));
            return;
        }

        const row = queue[queueIndex];
        const recipientEmail = row[emailKey];

        if (!recipientEmail) {
            logToConsole(`[${queueIndex + 1}/${queue.length}] ❌ 跳过: 未找到邮箱地址`);
            stats.failed++;
            stats.pending--;
            updateStatsCounters();
            updateTableRowStatus(queueIndex, 'failed');
            queueIndex++;
            processQueue();
            return;
        }

        updateTableRowStatus(queueIndex, 'sending');
        logToConsole(`[${queueIndex + 1}/${queue.length}] 📤 正在发送给: ${recipientEmail}...`);

        const finalSubject = renderTemplate(subjectTemplate, row);
        const finalBody = renderTemplate(bodyTemplate, row);

        let sendSuccess = false;
        let errMsg = "";

        if (currentEngine === 'msal') {
            const token = await getAccessToken();
            if (!token) {
                logToConsole(`[${queueIndex + 1}/${queue.length}] ❌ 失败: 无法获取 Access Token，暂停队列。`);
                pauseSending();
                return;
            }
            try {
                await sendMailAPI(token, finalSubject, finalBody, contentType, recipientEmail);
                sendSuccess = true;
            } catch (err) {
                errMsg = err.message;
            }
        } else {
            const smtpConfig = {
                smtpHost: $('email-smtp-host').value.trim(),
                smtpPort: $('email-smtp-port').value.trim(),
                secure: $('email-smtp-secure').checked,
                user: $('email-smtp-user').value.trim(),
                pass: $('email-smtp-pass').value.trim(),
                to: recipientEmail,
                subject: finalSubject,
                body: finalBody,
                contentType: contentType
            };
            try {
                await sendMailSMTP(smtpConfig);
                sendSuccess = true;
            } catch (err) {
                errMsg = err.message;
            }
        }

        if (sendSuccess) {
            logToConsole(`[${queueIndex + 1}/${queue.length}] ✅ 成功发送给 ${recipientEmail}`);
            stats.success++;
            stats.pending--;
            updateStatsCounters();
            updateTableRowStatus(queueIndex, 'success');
            
            queueIndex++;

            const baseDelay = parseInt($('email-delay-slider').value, 10) * 1000;
            const randomBias = Math.random() * 2000;
            const nextDelay = baseDelay + randomBias;
            
            sendTimer = setTimeout(processQueue, nextDelay);
        } else {
            logToConsole(`[${queueIndex + 1}/${queue.length}] ❌ 发送失败 (${recipientEmail}): ${errMsg}`);
            stats.failed++;
            stats.pending--;
            updateStatsCounters();
            updateTableRowStatus(queueIndex, 'failed');
            
            queueIndex++;
            sendTimer = setTimeout(processQueue, 3500);
        }
    }

    function switchEngine(engine) {
        currentEngine = engine;
        const msalTab = $('email-tab-msal');
        const smtpTab = $('email-tab-smtp');
        const msalConfig = $('email-msal-config');
        const smtpConfig = $('email-smtp-config');

        if (engine === 'msal') {
            msalTab.classList.add('active');
            smtpTab.classList.remove('active');
            msalConfig.style.display = 'block';
            smtpConfig.style.display = 'none';
            const account = getActiveAccount();
            updateAuthUI(account);
        } else {
            msalTab.classList.remove('active');
            smtpTab.classList.add('active');
            msalConfig.style.display = 'none';
            smtpConfig.style.display = 'flex';
            validateSmtpForm();
        }
    }

    function validateSmtpForm() {
        if (currentEngine !== 'smtp') return;
        const user = $('email-smtp-user').value.trim();
        const pass = $('email-smtp-pass').value.trim();
        const host = $('email-smtp-host').value.trim();
        const port = $('email-smtp-port').value.trim();
        const startBtn = $('email-btn-start');

        if (user && pass && host && port && queue.length > 0) {
            startBtn.disabled = false;
        } else {
            startBtn.disabled = true;
        }
    }

    async function sendMailSMTP(config) {
        const url = "/api/send-email";
        const response = await fetchWithTimeout(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(config),
            timeout: 15000
        });

        if (!response.ok) {
            const errJson = await response.json().catch(() => ({}));
            throw new Error(errJson.error ? errJson.error : `SMTP Error ${response.status}`);
        }
    }

    async function sendMailAPI(token, subject, body, contentType, recipientEmail) {

        const url = "https://graph.microsoft.com/v1.0/me/sendMail";

        const payload = {

            message: {

                subject: subject,

                body: {

                    contentType: contentType,

                    content: body

                },

                toRecipients: [

                    {

                        emailAddress: {

                            address: recipientEmail

                        }

                    }

                ]

            },

            saveToSentItems: "true"

        };



        const response = await fetchWithTimeout(url, {

            method: "POST",

            headers: {

                "Authorization": `Bearer ${token}`,

                "Content-Type": "application/json"

            },

            body: JSON.stringify(payload),

            timeout: 8000

        });



        if (!response.ok) {

            const errJson = await response.json().catch(() => ({}));

            throw new Error(errJson.error ? errJson.error.message : `HTTP Error ${response.status}`);

        }

    }



})();

