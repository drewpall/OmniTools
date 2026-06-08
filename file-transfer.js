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

            btnClearHistory: document.getElementById('p2p-btn-clear-history'),

            btnModeFiles: document.getElementById('p2p-btn-mode-files'),

            btnModeClipboard: document.getElementById('p2p-btn-mode-clipboard'),

            clipboardBadge: document.getElementById('p2p-clipboard-badge'),

            filesWorkspace: document.getElementById('p2p-files-workspace'),

            clipboardWorkspace: document.getElementById('p2p-clipboard-workspace'),

            clipboardInput: document.getElementById('p2p-clipboard-input'),

            btnSendClipboard: document.getElementById('p2p-btn-send-clipboard'),

            clipboardAutoClear: document.getElementById('p2p-clipboard-auto-clear'),

            emptyClipboardTip: document.getElementById('p2p-empty-clipboard-tip'),

            clipboardList: document.getElementById('p2p-clipboard-list'),

            btnClearClipboardHistory: document.getElementById('p2p-btn-clear-clipboard-history')

        };



        // Wire up UI events

        if (elements.btnCopyId) {

            elements.btnCopyId.addEventListener('click', () => {

                const id = elements.myIdInput.value;

                if (id) {

                    navigator.clipboard.writeText(id).then(() => {

                        const origText = elements.btnCopyId.innerText;

                        elements.btnCopyId.innerText = t('已复制', 'Copied');

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

                        elements.btnCopyLink.innerText = t('已复制连接', 'Link Copied');

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

                    alert(t('请输入对方的设备 ID！', 'Please enter the target device ID!'));

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

                if (confirm(t('确认要断开当前连接吗？未完成的任务将会失败。', 'Are you sure you want to disconnect? Unfinished tasks will fail.'))) {

                    disconnectPeer();

                }

            });

        }



        if (elements.btnClearHistory) {

            elements.btnClearHistory.addEventListener('click', () => {

                if (confirm(t('确认清空所有传输任务记录吗？', 'Are you sure you want to clear all transfer records?'))) {

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

                    alert(t('选择文件出错: ', 'Error selecting file: ') + err.message);

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

        // Clipboard Mode Tab Switcher
        if (elements.btnModeFiles && elements.btnModeClipboard) {

            elements.btnModeFiles.addEventListener('click', () => {

                elements.btnModeFiles.classList.add('active');

                elements.btnModeClipboard.classList.remove('active');

                elements.filesWorkspace.style.display = 'grid';

                elements.clipboardWorkspace.style.display = 'none';

            });

            elements.btnModeClipboard.addEventListener('click', () => {

                elements.btnModeClipboard.classList.add('active');

                elements.btnModeFiles.classList.remove('active');

                elements.filesWorkspace.style.display = 'none';

                elements.clipboardWorkspace.style.display = 'grid';

                if (elements.clipboardBadge) {

                    elements.clipboardBadge.style.display = 'none';

                }

            });

        }

        // Clipboard Send and keypress Events
        if (elements.btnSendClipboard && elements.clipboardInput) {

            elements.btnSendClipboard.addEventListener('click', sendClipboardText);

            elements.clipboardInput.addEventListener('keydown', (e) => {

                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {

                    e.preventDefault();

                    sendClipboardText();

                }

            });

        }

        // Clear Clipboard History
        if (elements.btnClearClipboardHistory) {

            elements.btnClearClipboardHistory.addEventListener('click', () => {

                if (confirm(t('确认清空所有历史剪贴板记录吗？', 'Are you sure you want to clear all clipboard records?'))) {

                    elements.clipboardList.innerHTML = '';

                    elements.clipboardList.style.display = 'none';

                    elements.emptyClipboardTip.style.display = 'flex';

                }

            });

        }

    }



    // Initialize PeerJS

    function initPeer() {

        if (myPeer) return;

        

        updateMyStatus('loading', t('正在连接信令服务器...', 'Connecting to signaling server...'));

        

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

                updateMyStatus('success', t('P2P 服务已就绪，等待连接', 'P2P service ready, waiting for connection'));

                

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

                updateMyStatus('error', t('P2P 服务错误: ', 'P2P Service Error: ') + err.type);

                

                if (err.type === 'peer-unavailable') {

                    alert(t('连接失败：指定的设备未上线，请确认 ID 是否输入正确。', 'Connection failed: The specified device is not online. Please check the ID.'));

                    resetToPairingUI();

                } else if (err.type === 'network') {

                    alert(t('网络连接错误，无法联络信令服务器。', 'Network connection error. Cannot reach signaling server.'));

                } else if (err.type === 'browser-incompatible') {

                    alert(t('很抱歉，您的浏览器不支持 WebRTC P2P 数据通道传输功能。', 'Sorry, your browser does not support WebRTC P2P data channels.'));

                }

            });



            myPeer.on('disconnected', () => {

                console.warn('Disconnected from PeerJS signaling server. Reconnecting...');

                updateMyStatus('loading', t('信令服务器断开，尝试重连...', 'Signaling server disconnected, trying to reconnect...'));

                myPeer.reconnect();

            });



        } catch (e) {

            console.error('Failed to create PeerJS object:', e);

            updateMyStatus('error', t('无法初始化 P2P 模块', 'Cannot initialize P2P module'));

        }

    }



    // Connect to target Peer ID

    function connectToPeer(targetId) {

        if (!myPeer || !myPeer.open) {

            pendingPeerConnectId = targetId;

            return;

        }

        

        if (targetId === myPeer.id) {

            alert(t('您不能连接到自己当前的设备！', 'You cannot connect to your own device!'));

            return;

        }

        

        if (activeConnection && activeConnection.peer === targetId) {

            return; // Already connected to this peer

        }

        

        updateMyStatus('loading', t('正在尝试连接设备: ', 'Trying to connect to device: ') + targetId + '...');

        if (elements.btnConnect) {

            elements.btnConnect.disabled = true;

            elements.btnConnect.innerText = t('正在建立连接...', 'Connecting...');

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

            alert(t('连接已断开！', 'Connection disconnected!'));

            resetToPairingUI();

        });

        

        conn.on('error', (err) => {

            console.error('P2P Connection Error:', err);

            alert(t('传输连接通道出错: ', 'Transfer connection channel error: ') + (err.message || err));

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

            elements.btnConnect.innerText = t('⚡ 建立安全连接', '⚡ Establish Secure Connection');

        }

        updateMyStatus('success', t('已连接到设备: ', 'Connected to: ') + peerId);

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

            elements.btnConnect.innerText = t('⚡ 建立安全连接', '⚡ Establish Secure Connection');

        }

        

        if (myPeer && myPeer.open) {

            updateMyStatus('success', t('P2P 服务已就绪，等待连接', 'P2P service ready, waiting for connection'));

        } else {

            updateMyStatus('error', t('P2P 服务未连接', 'P2P service disconnected'));

        }

        

        // Clear URI hash search parameter to avoid infinite loop auto-connection attempt

        if (window.location.hash.includes('?peer=')) {

            window.location.hash = '#file-transfer';

        }

        // Clear clipboard workspace state
        if (elements.clipboardList) {

            elements.clipboardList.innerHTML = '';

            elements.clipboardList.style.display = 'none';

        }

        if (elements.emptyClipboardTip) {

            elements.emptyClipboardTip.style.display = 'flex';

        }

        if (elements.clipboardInput) {

            elements.clipboardInput.value = '';

        }

        if (elements.clipboardBadge) {

            elements.clipboardBadge.style.display = 'none';

        }

        if (elements.btnModeFiles && elements.btnModeClipboard) {

            elements.btnModeFiles.classList.add('active');

            elements.btnModeClipboard.classList.remove('active');

        }

        if (elements.filesWorkspace && elements.clipboardWorkspace) {

            elements.filesWorkspace.style.display = 'grid';

            elements.clipboardWorkspace.style.display = 'none';

        }

    }



    /* ==========================================================================

       FILE TRANSMISSION LOGIC (CHUNKING & FLOW CONTROL)

       ========================================================================== */



    function handleFilesToSend(filesList) {

        try {

            if (!activeConnection || !activeConnection.open) {

                alert(t('未连接到任何设备，请先完成配对！', 'Not connected to any device, please pair first!'));

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

            alert(t('发送文件初始化失败: ', 'Failed to initialize sending file: ') + err.message);

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

            updateTransferStatusUI(transferId, 'sending', t('正在发送...', 'Sending...'));

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

            alert(t('队列处理失败: ', 'Failed to process queue: ') + err.message);

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

                    handleTransferFailure(transferId, t('读取本地文件失败', 'Failed to read local file'));

                };

                

                reader.readAsArrayBuffer(slice);

            } else {

                // Completed sending entire file, send end signal

                activeConnection.send({

                    type: 'end',

                    transferId: transferId

                });

                

                handleTransferSuccess(transferId, t('发送完成', 'Sent'));

            }

        } catch (err) {

            alert(t('文件发送过程异常: ', 'File sending error: ') + err.message);

            handleTransferFailure(currentSendingTransferId, t('传输失败: ', 'Transfer failed: ') + err.message);

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

                        updateTransferStatusUI(transferId, 'receiving', t('正在接收...', 'Receiving...'));

                        

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

                        handleTransferSuccess(transferId, t('已接收', 'Received'), downloadUrl);

                        

                        // Clean cache references

                        delete incomingTransfers[transferId];

                        if (currentIncomingTransferId === transferId) {

                            currentIncomingTransferId = null;

                        }

                        break;

                        

                    case 'cancel':

                        handleTransferFailure(transferId, t('对方取消了传输', 'Cancelled by peer'));

                        if (transferId === currentSendingTransferId) {

                            resetSendingState();

                        }

                        if (currentIncomingTransferId === transferId) {

                            currentIncomingTransferId = null;

                        }

                        break;

                        

                    case 'error':

                        handleTransferFailure(transferId, t('传输失败: ', 'Transfer failed: ') + data.message);

                        if (transferId === currentSendingTransferId) {

                            resetSendingState();

                        }

                        if (currentIncomingTransferId === transferId) {

                            currentIncomingTransferId = null;

                        }

                        break;

                    case 'clipboard':

                        addClipboardItemToUI(data.text, 'receive');

                        if (elements.btnModeClipboard && !elements.btnModeClipboard.classList.contains('active')) {

                            if (elements.clipboardBadge) {

                                elements.clipboardBadge.style.display = 'block';

                            }

                        }

                        break;

                }

            }

        } catch (err) {

            alert(t('接收数据异常: ', 'Exception receiving data: ') + err.message);

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

                        etaText.innerText = t('已用时 ', 'Elapsed: ') + elapsedSec + t('秒 • 剩余 ', 's • Remaining: ') + formatSeconds(etaSeconds);

                    } else {

                        etaText.innerText = t('已用时 ', 'Elapsed: ') + elapsedSec + t('秒', 's');

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

            elapsedText = ' ' + t('(用时 ' + elapsedSec + '秒)', '(Took ' + elapsedSec + 's)');

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

                downloadBtn.innerText = '💾 ' + t('保存文件', 'Save File');

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

        

        const directionLabel = direction === 'send' ? t('发送', 'Send') : t('接收', 'Receive');

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

                <span class="preview-badge badge-p2p-waiting" id="p2p-badge-${transferId}">${t('等待中', 'Waiting')}</span>

            </div>

            

            <div class="p2p-item-progress-container" id="p2p-progress-container-${transferId}" style="display: none; margin-top: 10px;">

                <div class="p2p-progress-bar-wrapper" style="height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden; position: relative;">

                    <div class="p2p-progress-bar-fill" id="p2p-fill-${transferId}" style="height: 100%; width: 0%; background: var(--primary-gradient); transition: width 0.1s ease; border-radius: 3px;"></div>

                </div>

                <div class="p2p-progress-metrics" style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-secondary); margin-top: 6px;">

                    <span id="p2p-percent-${transferId}">0%</span>

                    <span id="p2p-speed-${transferId}">0 KB/s</span>

                    <span id="p2p-eta-${transferId}">${t('计算中...', 'Calculating...')}</span>

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

        

        // Reset inline styles and class

        badge.style.color = '';

        badge.style.background = '';

        badge.className = 'preview-badge';

        

        if (state === 'sending' || state === 'receiving') {

            badge.classList.add('badge-p2p-running');

        } else if (state === 'completed') {

            badge.classList.add('badge-p2p-completed');

        } else if (state === 'failed') {

            badge.classList.add('badge-p2p-failed');

        } else {

            badge.classList.add('badge-p2p-waiting');

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

        if (seconds < 60) return `${seconds}${t('秒', 's')}`;

        const minutes = Math.floor(seconds / 60);

        const rem = seconds % 60;

        return `${minutes}${t('分', 'm')}${rem}${t('秒', 's')}`;

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

            alert(t('抱歉，您的设备或浏览器不支持摄像头访问！', 'Sorry, your device or browser does not support camera access!'));

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

                alert(t('无法访问摄像头，请检查是否已授予摄像头权限！', 'Cannot access camera. Please check camera permissions!'));

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

    function sendClipboardText() {

        const text = elements.clipboardInput.value.trim();

        if (!text) {

            alert(t('请输入需要发送的文本内容！', 'Please enter text content to send!'));

            return;

        }

        if (!activeConnection || !activeConnection.open) {

            alert(t('连接已断开，无法发送！', 'Connection disconnected, cannot send!'));

            return;

        }

        try {

            activeConnection.send({

                type: 'clipboard',

                text: text

            });

            addClipboardItemToUI(text, 'send');

            if (elements.clipboardAutoClear && elements.clipboardAutoClear.checked) {

                elements.clipboardInput.value = '';

            }

        } catch (err) {

            alert(t('发送文本出错: ', 'Error sending text: ') + err.message);

        }

    }

    function addClipboardItemToUI(text, direction) {

        if (elements.emptyClipboardTip) elements.emptyClipboardTip.style.display = 'none';

        if (elements.clipboardList) elements.clipboardList.style.display = 'flex';

        const itemId = `cb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const now = new Date();

        const timeString = now.toTimeString().split(' ')[0];

        const directionLabel = direction === 'send' ? t('发送', 'Send') : t('接收', 'Receive');

        const badgeClass = direction === 'send' ? 'badge-orig' : 'badge-comp';

        const item = document.createElement('div');

        item.className = 'p2p-queue-item';

        item.id = `p2p-item-${itemId}`;

        item.innerHTML = `
            <div class="p2p-item-header" style="align-items: center; display: flex;">
                <span class="p2p-item-icon" style="margin-right: 12px;">📋</span>
                <div class="p2p-item-info" style="flex-grow: 1;">
                    <div class="p2p-item-meta" style="margin-top: 0; display: flex; align-items: center; gap: 8px;">
                        <span class="p2p-direction-badge ${badgeClass}">${directionLabel}</span>
                        <span style="opacity: 0.6; font-size: 11px;">⏰ ${timeString}</span>
                    </div>
                </div>
                <div class="p2p-item-actions" style="display: flex; gap: 8px;">
                    <button class="btn btn-secondary btn-xs btn-copy-cb" style="padding: 4px 8px; font-size: 11px;">
                        ${t('📋 复制', '📋 Copy')}
                    </button>
                    <button class="btn btn-secondary btn-xs btn-delete-cb" style="border-color: #EF4444; color: #EF4444; padding: 4px 8px; font-size: 11px;">
                        🗑️
                    </button>
                </div>
            </div>
            <div class="clipboard-text-content" style="background: rgba(0,0,0,0.2); border-radius: var(--radius-sm); padding: 10px; font-family: monospace; font-size: 12.5px; white-space: pre-wrap; word-break: break-all; max-height: 120px; overflow-y: auto; text-align: left; color: var(--text-primary); margin-top: 10px;"></div>
        `;

        item.querySelector('.clipboard-text-content').textContent = text;

        const copyBtn = item.querySelector('.btn-copy-cb');

        copyBtn.addEventListener('click', () => {

            navigator.clipboard.writeText(text).then(() => {

                const origText = copyBtn.innerText;

                copyBtn.innerText = t('已复制', 'Copied');

                setTimeout(() => copyBtn.innerText = origText, 1500);

            });

        });

        const deleteBtn = item.querySelector('.btn-delete-cb');

        deleteBtn.addEventListener('click', () => {

            item.remove();

            if (elements.clipboardList.children.length === 0) {

                elements.clipboardList.style.display = 'none';

                elements.emptyClipboardTip.style.display = 'flex';

            }

        });

        if (elements.clipboardList) {

            elements.clipboardList.insertBefore(item, elements.clipboardList.firstChild);

        }

    }

})();

