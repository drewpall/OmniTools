/**
 * OmniToolbox - P2P File Transfer Logic
 * Powered by WebRTC via PeerJS and QRious QR code generator
 */

(function() {
    let myPeer = null;
    let activeConnection = null;
    let pendingPeerConnectId = null;
    
    // Transfer Queues & States
    let sendQueue = [];
    let isCurrentlySending = false;
    let currentSendingTransferId = null;
    let currentIncomingTransferId = null;
    
    let incomingTransfers = {}; // transferId -> { name, size, mimeType, chunks: [], receivedSize: 0, startTime: 0, lastBytes: 0, lastTime: 0 }
    let outgoingTransfers = {}; // transferId -> { file, offset: 0, startTime: 0, lastBytes: 0, lastTime: 0 }
    let transferStats = {};     // transferId -> { startTime, lastBytes, lastTime, totalBytes, name, direction }

    const CHUNK_SIZE = 64 * 1024; // 64KB chunk size

    window.initFileTransfer = function() {
        if (window.isP2PInitialized) return;
        
        setupDOMElements();
        initPeer();
        checkUrlHash();
        
        // Listen to hash changes for auto-connections
        window.addEventListener('hashchange', checkUrlHash);
        
        window.isP2PInitialized = true;
    };

    // DOM References
    let elements = {};
    function setupDOMElements() {
        elements = {
            pairingPanel: document.getElementById('p2p-pairing-panel'),
            activePanel: document.getElementById('p2p-active-panel'),
            
            myStatusDot: document.getElementById('p2p-my-status-dot'),
            myStatusText: document.getElementById('p2p-my-status-text'),
            myIdInput: document.getElementById('p2p-my-id'),
            btnCopyId: document.getElementById('p2p-btn-copy-id'),
            btnCopyLink: document.getElementById('p2p-btn-copy-link'),
            qrCanvas: document.getElementById('p2p-qr-canvas'),
            
            targetIdInput: document.getElementById('p2p-target-id'),
            btnConnect: document.getElementById('p2p-btn-connect'),
            btnStartScan: document.getElementById('p2p-btn-start-scan'),
            btnCancelScan: document.getElementById('p2p-btn-cancel-scan'),
            scannerWrapper: document.getElementById('p2p-scanner-wrapper'),
            scannerCanvas: document.getElementById('p2p-scanner-canvas'),
            
            connectedPeerId: document.getElementById('p2p-connected-peer-id'),
            btnDisconnect: document.getElementById('p2p-btn-disconnect'),
            
            dropZone: document.getElementById('p2p-drop-zone'),
            fileInput: document.getElementById('p2p-file-input'),
            
            emptyQueueTip: document.getElementById('p2p-empty-queue-tip'),
            queueList: document.getElementById('p2p-queue-list'),
            btnClearHistory: document.getElementById('p2p-btn-clear-history')
        };

        // Wire up UI events
        if (elements.btnCopyId) {
            elements.btnCopyId.addEventListener('click', () => {
                const id = elements.myIdInput.value;
                if (id) {
                    navigator.clipboard.writeText(id).then(() => {
                        const origText = elements.btnCopyId.innerText;
                        elements.btnCopyId.innerText = '已复制';
                        setTimeout(() => elements.btnCopyId.innerText = origText, 1500);
                    });
                }
            });
        }

        if (elements.btnCopyLink) {
            elements.btnCopyLink.addEventListener('click', () => {
                const id = elements.myIdInput.value;
                if (id) {
                    const link = `${window.location.origin}${window.location.pathname}#file-transfer?peer=${id}`;
                    navigator.clipboard.writeText(link).then(() => {
                        const origText = elements.btnCopyLink.innerText;
                        elements.btnCopyLink.innerText = '已复制连接';
                        setTimeout(() => elements.btnCopyLink.innerText = origText, 1500);
                    });
                }
            });
        }

        if (elements.btnConnect) {
            elements.btnConnect.addEventListener('click', () => {
                const targetId = elements.targetIdInput.value.trim();
                if (targetId) {
                    connectToPeer(targetId);
                } else {
                    alert('请输入对方的设备 ID！');
                }
            });
        }

        if (elements.btnStartScan) {
            elements.btnStartScan.addEventListener('click', startScanner);
        }

        if (elements.btnCancelScan) {
            elements.btnCancelScan.addEventListener('click', stopScanner);
        }

        if (elements.btnDisconnect) {
            elements.btnDisconnect.addEventListener('click', () => {
                if (confirm('确认要断开当前连接吗？未完成的任务将会失败。')) {
                    disconnectPeer();
                }
            });
        }

        if (elements.btnClearHistory) {
            elements.btnClearHistory.addEventListener('click', () => {
                if (confirm('确认清空所有传输任务记录吗？')) {
                    elements.queueList.innerHTML = '';
                    elements.queueList.style.display = 'none';
                    elements.emptyQueueTip.style.display = 'flex';
                }
            });
        }

        // Drag and drop events
        if (elements.dropZone && elements.fileInput) {
            elements.dropZone.addEventListener('click', () => elements.fileInput.click());
            
            // Prevent event bubbling on mobile devices to avoid multiple click loops
            elements.fileInput.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            elements.fileInput.addEventListener('change', (e) => {
                try {
                    if (e.target.files && e.target.files.length > 0) {
                        handleFilesToSend(e.target.files);
                    }
                } catch (err) {
                    alert('选择文件出错: ' + err.message);
                }
            });

            elements.dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                elements.dropZone.classList.add('dragover');
            });

            elements.dropZone.addEventListener('dragleave', () => {
                elements.dropZone.classList.remove('dragover');
            });

            elements.dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                elements.dropZone.classList.remove('dragover');
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleFilesToSend(e.dataTransfer.files);
                }
            });
        }
    }

    // Initialize PeerJS
    function initPeer() {
        if (myPeer) return;
        
        updateMyStatus('loading', '正在连接信令服务器...');
        
        // Use Google's public STUN servers for WebRTC NAT traversal
        const peerConfig = {
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun.nextcloud.com:443' }
                ]
            },
            debug: 1 // Only output errors
        };

        try {
            myPeer = new Peer(peerConfig);
            
            myPeer.on('open', (id) => {
                console.log('Successfully registered to PeerJS cloud with ID:', id);
                updateMyStatus('success', 'P2P 服务已就绪，等待连接');
                
                if (elements.myIdInput) {
                    elements.myIdInput.value = id;
                }
                if (elements.btnCopyId) elements.btnCopyId.disabled = false;
                if (elements.btnCopyLink) elements.btnCopyLink.disabled = false;
                
                generateQR(id);
                
                // If there was a pending auto-connection URL request, handle it now
                if (pendingPeerConnectId) {
                    connectToPeer(pendingPeerConnectId);
                    pendingPeerConnectId = null;
                }
            });
            
            myPeer.on('connection', (conn) => {
                // Receive incoming connection requests from another peer
                if (activeConnection) {
                    // Already connected, reject incoming connection requests
                    console.log('Rejecting incoming connection from:', conn.peer, ' (already connected to:', activeConnection.peer, ')');
                    conn.on('open', () => {
                        conn.send({ type: 'error', message: 'Busy' });
                        setTimeout(() => conn.close(), 500);
                    });
                    return;
                }
                handleIncomingConnection(conn);
            });
            
            myPeer.on('error', (err) => {
                console.error('PeerJS global error:', err);
                updateMyStatus('error', `P2P 服务错误: ${err.type}`);
                
                if (err.type === 'peer-unavailable') {
                    alert('连接失败：指定的设备未上线，请确认 ID 是否输入正确。');
                    resetToPairingUI();
                } else if (err.type === 'network') {
                    alert('网络连接错误，无法联络信令服务器。');
                } else if (err.type === 'browser-incompatible') {
                    alert('很抱歉，您的浏览器不支持 WebRTC P2P 数据通道传输功能。');
                }
            });

            myPeer.on('disconnected', () => {
                console.warn('Disconnected from PeerJS signaling server. Reconnecting...');
                updateMyStatus('loading', '信令服务器断开，尝试重连...');
                myPeer.reconnect();
            });

        } catch (e) {
            console.error('Failed to create PeerJS object:', e);
            updateMyStatus('error', '无法初始化 P2P 模块');
        }
    }

    // Connect to target Peer ID
    function connectToPeer(targetId) {
        if (!myPeer || !myPeer.open) {
            pendingPeerConnectId = targetId;
            return;
        }
        
        if (targetId === myPeer.id) {
            alert('您不能连接到自己当前的设备！');
            return;
        }
        
        if (activeConnection && activeConnection.peer === targetId) {
            return; // Already connected to this peer
        }
        
        updateMyStatus('loading', `正在尝试连接设备: ${targetId}...`);
        if (elements.btnConnect) {
            elements.btnConnect.disabled = true;
            elements.btnConnect.innerText = '正在建立连接...';
        }
        
        console.log('Initiating connection to peer:', targetId);
        
        const conn = myPeer.connect(targetId, {
            reliable: true
        });
        
        handleIncomingConnection(conn);
    }

    // Handles incoming or outgoing connections
    function handleIncomingConnection(conn) {
        activeConnection = conn;
        
        console.log('Setting up connection handlers for peer:', conn.peer);
        
        conn.on('open', () => {
            console.log('P2P connection established with peer:', conn.peer);
            
            // Setup RTCDataChannel configuration
            if (conn.dataChannel) {
                conn.dataChannel.bufferedAmountLowThreshold = 256 * 1024; // 256KB threshold
            }
            
            // Switch UI to active mode
            showActiveUI(conn.peer);
        });
        
        conn.on('data', (data) => {
            handleReceivedData(data);
        });
        
        conn.on('close', () => {
            console.warn('P2P connection closed by peer:', conn.peer);
            alert('连接已断开！');
            resetToPairingUI();
        });
        
        conn.on('error', (err) => {
            console.error('P2P Connection Error:', err);
            alert(`传输连接通道出错: ${err.message || err}`);
            resetToPairingUI();
        });
    }

    // Reset current active connection
    function disconnectPeer() {
        if (activeConnection) {
            activeConnection.close();
        }
        resetToPairingUI();
    }

    // Auto connect helper checking hash parameters
    function checkUrlHash() {
        const hash = window.location.hash;
        if (hash.startsWith('#file-transfer')) {
            const index = hash.indexOf('?');
            if (index !== -1) {
                const query = hash.substring(index + 1);
                const params = new URLSearchParams(query);
                const peerId = params.get('peer');
                if (peerId) {
                    // Auto switch sidebar to file-transfer
                    const transferNav = document.querySelector('[data-target="file-transfer"]');
                    if (transferNav && !transferNav.classList.contains('active')) {
                        transferNav.click();
                    }
                    
                    if (elements.targetIdInput) {
                        elements.targetIdInput.value = peerId;
                    }
                    
                    if (myPeer && myPeer.open) {
                        connectToPeer(peerId);
                    } else {
                        pendingPeerConnectId = peerId;
                    }
                }
            }
        }
    }

    // UI Updates
    function updateMyStatus(state, text) {
        if (!elements.myStatusDot || !elements.myStatusText) return;
        
        elements.myStatusDot.className = 'status-dot';
        if (state === 'loading') {
            elements.myStatusDot.classList.add('status-loading');
        } else if (state === 'success') {
            elements.myStatusDot.classList.add('status-success');
        } else if (state === 'error') {
            elements.myStatusDot.classList.add('status-error');
        }
        
        elements.myStatusText.innerText = text;
    }

    function generateQR(id) {
        if (!elements.qrCanvas) return;
        
        const link = `${window.location.origin}${window.location.pathname}#file-transfer?peer=${id}`;
        
        try {
            if (window.QRious) {
                new QRious({
                    element: elements.qrCanvas,
                    value: link,
                    size: 150,
                    background: '#ffffff',
                    foreground: '#000000',
                    level: 'M'
                });
            } else {
                console.warn('QRious library not loaded yet');
            }
        } catch (err) {
            console.error('Failed to generate QR Code:', err);
        }
    }

    function showActiveUI(peerId) {
        if (elements.pairingPanel) elements.pairingPanel.style.display = 'none';
        if (elements.activePanel) elements.activePanel.style.display = 'flex';
        
        if (elements.connectedPeerId) {
            elements.connectedPeerId.innerText = peerId;
        }
        
        // Reset connect button state
        if (elements.btnConnect) {
            elements.btnConnect.disabled = false;
            elements.btnConnect.innerText = '⚡ 建立安全连接';
        }
        updateMyStatus('success', `已连接到设备: ${peerId}`);
    }

    function resetToPairingUI() {
        activeConnection = null;
        sendQueue = [];
        isCurrentlySending = false;
        currentSendingTransferId = null;
        outgoingTransfers = {};
        incomingTransfers = {};
        
        if (elements.pairingPanel) elements.pairingPanel.style.display = 'flex';
        if (elements.activePanel) elements.activePanel.style.display = 'none';
        
        if (elements.btnConnect) {
            elements.btnConnect.disabled = false;
            elements.btnConnect.innerText = '⚡ 建立安全连接';
        }
        
        if (myPeer && myPeer.open) {
            updateMyStatus('success', 'P2P 服务已就绪，等待连接');
        } else {
            updateMyStatus('error', 'P2P 服务未连接');
        }
        
        // Clear URI hash search parameter to avoid infinite loop auto-connection attempt
        if (window.location.hash.includes('?peer=')) {
            window.location.hash = '#file-transfer';
        }
    }

    /* ==========================================================================
       FILE TRANSMISSION LOGIC (CHUNKING & FLOW CONTROL)
       ========================================================================== */

    function handleFilesToSend(filesList) {
        try {
            if (!activeConnection || !activeConnection.open) {
                alert('未连接到任何设备，请先完成配对！');
                return;
            }

            for (let i = 0; i < filesList.length; i++) {
                const file = filesList[i];
                const transferId = `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                
                // Register in queue UI
                addTransferToQueueUI(transferId, file.name, file.size, file.type, 'send');
                
                // Save state
                outgoingTransfers[transferId] = {
                    file: file,
                    offset: 0,
                    startTime: 0,
                    lastBytes: 0,
                    lastTime: 0
                };
                
                sendQueue.push(transferId);
            }
            
            // Trigger queue processing
            processSendQueue();
        } catch (err) {
            alert('发送文件初始化失败: ' + err.message);
        }
    }

    function processSendQueue() {
        try {
            if (isCurrentlySending || sendQueue.length === 0) return;
            
            isCurrentlySending = true;
            const transferId = sendQueue.shift();
            currentSendingTransferId = transferId;
            
            const transfer = outgoingTransfers[transferId];
            transfer.startTime = Date.now();
            transfer.lastTime = Date.now();
            
            // Setup stats tracking
            transferStats[transferId] = {
                startTime: transfer.startTime,
                lastBytes: 0,
                lastTime: transfer.lastTime,
                totalBytes: transfer.file.size,
                name: transfer.file.name,
                direction: 'send'
            };
            
            // Update UI state to "Connecting/Sending"
            updateTransferStatusUI(transferId, 'sending', '正在发送...');
            showProgressBar(transferId);
            
            // Inform receiver we are sending metadata
            activeConnection.send({
                type: 'start',
                transferId: transferId,
                name: transfer.file.name,
                size: transfer.file.size,
                fileType: transfer.file.type
            });
            
            console.log('Started sending file:', transfer.file.name, 'Size:', transfer.file.size);
            
            // Start chunk reading loop
            sendNextChunk();
        } catch (err) {
            alert('队列处理失败: ' + err.message);
            isCurrentlySending = false;
        }
    }

    function sendNextChunk() {
        try {
            const transferId = currentSendingTransferId;
            if (!transferId || !activeConnection || !activeConnection.open) return;
            
            const transfer = outgoingTransfers[transferId];
            if (!transfer) return;
            
            const file = transfer.file;
            const offset = transfer.offset;
            
            // Check backpressure limit in WebRTC channel buffer (keep it under 1MB)
            if (activeConnection.dataChannel && activeConnection.dataChannel.bufferedAmount > 1024 * 1024) {
                activeConnection.dataChannel.onbufferedamountlow = () => {
                    activeConnection.dataChannel.onbufferedamountlow = null;
                    sendNextChunk();
                };
                return;
            }

            if (offset < file.size) {
                const nextSize = Math.min(CHUNK_SIZE, file.size - offset);
                const slice = file.slice(offset, offset + nextSize);
                const reader = new FileReader();
                
                reader.onload = (e) => {
                    if (!activeConnection || !activeConnection.open) return;
                    
                    // Send raw chunk binary data directly (bypasses PeerJS binarypack serialization bugs on mobile)
                    activeConnection.send(e.target.result);
                    
                    transfer.offset += nextSize;
                    
                    // Update stats and UI progress
                    updateTransferProgress(transferId, transfer.offset, file.size);
                    
                    // Loop
                    sendNextChunk();
                };
                
                reader.onerror = (err) => {
                    console.error('FileReader slice read error:', err);
                    activeConnection.send({ type: 'error', transferId: transferId, message: 'Read file failed locally' });
                    handleTransferFailure(transferId, '读取本地文件失败');
                };
                
                reader.readAsArrayBuffer(slice);
            } else {
                // Completed sending entire file, send end signal
                activeConnection.send({
                    type: 'end',
                    transferId: transferId
                });
                
                handleTransferSuccess(transferId, '发送完成');
            }
        } catch (err) {
            alert('文件发送过程异常: ' + err.message);
            handleTransferFailure(currentSendingTransferId, '传输失败: ' + err.message);
        }
    }

    // Receive handler
    function handleReceivedData(data) {
        try {
            // Check if incoming data is a raw binary chunk (ArrayBuffer or Blob)
            if (data instanceof ArrayBuffer || ArrayBuffer.isView(data) || data instanceof Blob) {
                const transferId = currentIncomingTransferId;
                if (!transferId) return;

                const incoming = incomingTransfers[transferId];
                if (!incoming) return;

                const chunkData = (data instanceof ArrayBuffer) ? data : data.buffer;
                incoming.chunks.push(chunkData);
                incoming.receivedSize += chunkData.byteLength || chunkData.size || 0;

                updateTransferProgress(transferId, incoming.receivedSize, incoming.size);
                return;
            }

            // Otherwise, it is a JSON control message
            if (data && typeof data === 'object') {
                const transferId = data.transferId;
                
                switch (data.type) {
                    case 'start':
                        console.log('Receiving file metadata:', data.name, 'size:', data.size);
                        currentIncomingTransferId = transferId;
                        
                        // Add to list
                        addTransferToQueueUI(transferId, data.name, data.size, data.fileType, 'receive');
                        showProgressBar(transferId);
                        updateTransferStatusUI(transferId, 'receiving', '正在接收...');
                        
                        incomingTransfers[transferId] = {
                            name: data.name,
                            size: data.size,
                            mimeType: data.fileType,
                            chunks: [],
                            receivedSize: 0,
                            startTime: Date.now(),
                            lastBytes: 0,
                            lastTime: Date.now()
                        };
                        
                        transferStats[transferId] = {
                            startTime: incomingTransfers[transferId].startTime,
                            lastBytes: 0,
                            lastTime: incomingTransfers[transferId].lastTime,
                            totalBytes: data.size,
                            name: data.name,
                            direction: 'receive'
                        };
                        break;
                        
                    case 'end':
                        const fileState = incomingTransfers[transferId];
                        if (!fileState) return;
                        
                        // Reconstruction
                        const blob = new Blob(fileState.chunks, { type: fileState.mimeType || 'application/octet-stream' });
                        const downloadUrl = URL.createObjectURL(blob);
                        
                        // Success UI & Add manual download link
                        handleTransferSuccess(transferId, '已接收', downloadUrl);
                        
                        // Clean cache references
                        delete incomingTransfers[transferId];
                        if (currentIncomingTransferId === transferId) {
                            currentIncomingTransferId = null;
                        }
                        break;
                        
                    case 'cancel':
                        handleTransferFailure(transferId, '对方取消了传输');
                        if (transferId === currentSendingTransferId) {
                            resetSendingState();
                        }
                        if (currentIncomingTransferId === transferId) {
                            currentIncomingTransferId = null;
                        }
                        break;
                        
                    case 'error':
                        handleTransferFailure(transferId, `传输失败: ${data.message}`);
                        if (transferId === currentSendingTransferId) {
                            resetSendingState();
                        }
                        if (currentIncomingTransferId === transferId) {
                            currentIncomingTransferId = null;
                        }
                        break;
                }
            }
        } catch (err) {
            alert('接收数据异常: ' + err.message);
        }
    }

    function resetSendingState() {
        isCurrentlySending = false;
        currentSendingTransferId = null;
        setTimeout(processSendQueue, 500);
    }

    function updateTransferProgress(transferId, currentBytes, totalBytes) {
        const percent = Math.min(100, Math.floor((currentBytes / totalBytes) * 100));
        
        // Progress bar fill
        const fill = document.getElementById(`p2p-fill-${transferId}`);
        if (fill) fill.style.width = `${percent}%`;
        
        // Percentage text
        const percentText = document.getElementById(`p2p-percent-${transferId}`);
        if (percentText) percentText.innerText = `${percent}%`;
        
        // Speed and ETA calculations
        const stats = transferStats[transferId];
        if (stats) {
            const now = Date.now();
            const elapsed = (now - stats.lastTime) / 1000; // time window in seconds
            
            if (elapsed >= 0.5) {
                const bytesInWindow = currentBytes - stats.lastBytes;
                const speedBps = bytesInWindow / elapsed; // bytes per second
                
                stats.lastBytes = currentBytes;
                stats.lastTime = now;
                
                const speedText = document.getElementById(`p2p-speed-${transferId}`);
                if (speedText) {
                    speedText.innerText = `${formatBytes(speedBps)}/s`;
                }
                
                // Calculate ETA
                const etaText = document.getElementById(`p2p-eta-${transferId}`);
                if (etaText) {
                    const elapsedSec = Math.round((now - stats.startTime) / 1000);
                    if (speedBps > 0) {
                        const remainingBytes = totalBytes - currentBytes;
                        const etaSeconds = Math.ceil(remainingBytes / speedBps);
                        etaText.innerText = `已用时 ${elapsedSec}秒 • 剩余 ${formatSeconds(etaSeconds)}`;
                    } else {
                        etaText.innerText = `已用时 ${elapsedSec}秒`;
                    }
                }
            }
        }
    }

    function handleTransferSuccess(transferId, statusText, downloadUrl = null) {
        let elapsedText = '';
        const stats = transferStats[transferId];
        if (stats && stats.startTime) {
            const elapsedMs = Date.now() - stats.startTime;
            const elapsedSec = (elapsedMs / 1000).toFixed(1);
            elapsedText = ` (用时 ${elapsedSec}秒)`;
        }
        updateTransferStatusUI(transferId, 'completed', statusText + elapsedText);
        hideProgressBar(transferId);
        
        const actionsDiv = document.getElementById(`p2p-actions-${transferId}`);
        if (actionsDiv) {
            actionsDiv.innerHTML = '';
            actionsDiv.style.display = 'flex';
            
            if (downloadUrl) {
                const downloadBtn = document.createElement('a');
                downloadBtn.href = downloadUrl;
                downloadBtn.download = transferStats[transferId] ? transferStats[transferId].name : 'download';
                downloadBtn.className = 'btn btn-primary btn-xs';
                downloadBtn.innerText = '💾 保存文件';
                actionsDiv.appendChild(downloadBtn);
            }
        }
        
        if (transferId === currentSendingTransferId) {
            resetSendingState();
        }
    }

    function handleTransferFailure(transferId, errorText) {
        updateTransferStatusUI(transferId, 'failed', errorText);
        hideProgressBar(transferId);
        
        if (transferId === currentSendingTransferId) {
            resetSendingState();
        }
    }

    function triggerAutomaticDownload(url, filename) {
        try {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (e) {
            console.error('Automatic file trigger download blocked or failed:', e);
        }
    }

    /* ==========================================================================
       DYNAMIC UI GENERATORS
       ========================================================================== */

    function addTransferToQueueUI(transferId, name, size, mimeType, direction) {
        if (elements.emptyQueueTip) elements.emptyQueueTip.style.display = 'none';
        if (elements.queueList) elements.queueList.style.display = 'flex';

        const item = document.createElement('div');
        item.className = 'p2p-queue-item';
        item.id = `p2p-item-${transferId}`;
        
        const directionLabel = direction === 'send' ? '发送' : '接收';
        const badgeClass = direction === 'send' ? 'badge-orig' : 'badge-comp';
        
        const now = new Date();
        const timeString = now.toTimeString().split(' ')[0]; // HH:MM:SS
        
        item.innerHTML = `
            <div class="p2p-item-header">
                <span class="p2p-item-icon">${getFileIcon(mimeType)}</span>
                <div class="p2p-item-info">
                    <div class="p2p-item-name" title="${name}">${name}</div>
                    <div class="p2p-item-meta">${formatBytes(size)} • <span class="p2p-direction-badge ${badgeClass}">${directionLabel}</span> • <span style="opacity: 0.6; font-size: 11px;">⏰ ${timeString}</span></div>
                </div>
                <span class="preview-badge" id="p2p-badge-${transferId}" style="background: rgba(255,255,255,0.05); color: var(--text-secondary);">等待中</span>
            </div>
            
            <div class="p2p-item-progress-container" id="p2p-progress-container-${transferId}" style="display: none; margin-top: 10px;">
                <div class="p2p-progress-bar-wrapper" style="height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden; position: relative;">
                    <div class="p2p-progress-bar-fill" id="p2p-fill-${transferId}" style="height: 100%; width: 0%; background: var(--primary-gradient); transition: width 0.1s ease; border-radius: 3px;"></div>
                </div>
                <div class="p2p-progress-metrics" style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-secondary); margin-top: 6px;">
                    <span id="p2p-percent-${transferId}">0%</span>
                    <span id="p2p-speed-${transferId}">0 KB/s</span>
                    <span id="p2p-eta-${transferId}">计算中...</span>
                </div>
            </div>
            
            <div class="p2p-item-actions" id="p2p-actions-${transferId}" style="display: none; margin-top: 10px; justify-content: flex-end;">
                <!-- Actions added dynamically -->
            </div>
        `;
        
        if (elements.queueList) {
            elements.queueList.insertBefore(item, elements.queueList.firstChild);
        }
    }

    function showProgressBar(transferId) {
        const prog = document.getElementById(`p2p-progress-container-${transferId}`);
        if (prog) prog.style.display = 'block';
    }

    function hideProgressBar(transferId) {
        const prog = document.getElementById(`p2p-progress-container-${transferId}`);
        if (prog) prog.style.display = 'none';
    }

    function updateTransferStatusUI(transferId, state, text) {
        const badge = document.getElementById(`p2p-badge-${transferId}`);
        if (!badge) return;
        
        badge.innerText = text;
        badge.style.color = '#ffffff';
        
        if (state === 'sending' || state === 'receiving') {
            badge.style.background = 'rgba(59, 130, 246, 0.2)';
            badge.style.color = '#93C5FD';
        } else if (state === 'completed') {
            badge.style.background = 'rgba(16, 185, 129, 0.2)';
            badge.style.color = '#A7F3D0';
        } else if (state === 'failed') {
            badge.style.background = 'rgba(239, 68, 68, 0.2)';
            badge.style.color = '#FCA5A5';
        }
    }

    /* ==========================================================================
       UTILITY FORMATTERS
       ========================================================================== */

    function formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    function formatSeconds(seconds) {
        if (seconds < 60) return `${seconds}秒`;
        const minutes = Math.floor(seconds / 60);
        const rem = seconds % 60;
        return `${minutes}分${rem}秒`;
    }

    function getFileIcon(mimeType) {
        if (!mimeType) return '📄';
        const type = mimeType.toLowerCase();
        if (type.startsWith('image/')) return '🖼️';
        if (type.startsWith('video/')) return '🎬';
        if (type.startsWith('audio/')) return '🎵';
        if (type.startsWith('text/') || type.includes('pdf') || type.includes('document') || type.includes('epub')) return '📄';
        if (type.includes('zip') || type.includes('rar') || type.includes('tar') || type.includes('gzip') || type.includes('7z')) return '📦';
        return '📄';
    }

    /* ==========================================================================
       IN-APP QR CODE CAMERA SCANNER (jsQR implementation)
       ========================================================================== */
    let scanStream = null;
    let isScanning = false;
    let scanVideoElement = null;

    function startScanner() {
        if (isScanning) return;

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert('抱歉，您的设备或浏览器不支持摄像头访问！');
            return;
        }

        elements.scannerWrapper.style.display = 'block';
        elements.btnStartScan.disabled = true;
        isScanning = true;

        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
            .then((stream) => {
                scanStream = stream;
                scanVideoElement = document.createElement('video');
                scanVideoElement.srcObject = stream;
                scanVideoElement.setAttribute('playsinline', true); // Required for iOS Safari
                scanVideoElement.play();
                requestAnimationFrame(tickScan);
            })
            .catch((err) => {
                console.error('Camera access error:', err);
                alert('无法访问摄像头，请检查是否已授予摄像头权限！');
                stopScanner();
            });
    }

    function stopScanner() {
        isScanning = false;
        if (elements.scannerWrapper) elements.scannerWrapper.style.display = 'none';
        if (elements.btnStartScan) elements.btnStartScan.disabled = false;

        if (scanStream) {
            scanStream.getTracks().forEach(track => track.stop());
            scanStream = null;
        }
        if (scanVideoElement) {
            scanVideoElement.pause();
            scanVideoElement.srcObject = null;
            scanVideoElement = null;
        }
    }

    function tickScan() {
        if (!isScanning) return;

        if (scanVideoElement && scanVideoElement.readyState === scanVideoElement.HAVE_ENOUGH_DATA) {
            const canvas = elements.scannerCanvas;
            if (canvas) {
                const ctx = canvas.getContext('2d');
                canvas.width = scanVideoElement.videoWidth;
                canvas.height = scanVideoElement.videoHeight;

                // Draw video frame to scanner canvas
                ctx.drawImage(scanVideoElement, 0, 0, canvas.width, canvas.height);

                try {
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    if (window.jsQR) {
                        const code = jsQR(imageData.data, imageData.width, imageData.height, {
                            inversionAttempts: 'dontInvert'
                        });

                        if (code) {
                            console.log('QR Code scanned successfully:', code.data);
                            const scannedData = code.data;
                            let targetPeerId = '';

                            if (scannedData.includes('peer=')) {
                                const params = new URLSearchParams(scannedData.substring(scannedData.indexOf('?')));
                                targetPeerId = params.get('peer');
                            } else {
                                targetPeerId = scannedData.trim();
                            }

                            if (targetPeerId) {
                                elements.targetIdInput.value = targetPeerId;
                                stopScanner();
                                connectToPeer(targetPeerId);
                                return;
                            }
                        }
                    }
                } catch (err) {
                    console.error('QR frame decode error:', err);
                }
            }
        }

        requestAnimationFrame(tickScan);
    }

})();
