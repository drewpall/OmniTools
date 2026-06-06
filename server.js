const express = require('express');
const path = require('path');
const app = express();

// Set cross-origin isolation headers to enable SharedArrayBuffer (multi-threading)
app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    next();
});

// Serve static files from the current directory
app.use(express.static(__dirname));

// Default route served
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server on port 3000, fallback to other ports if occupied
let port = 3000;
function startServer() {
    const server = app.listen(port, () => {
        console.log(`\n==================================================`);
        console.log(`🚀 [OmniToolbox] Local Server is running!`);
        console.log(`🔗 Address: http://localhost:${port}`);
        console.log(`🔒 Cross-Origin Isolation headers have been injected.`);
        console.log(`==================================================\n`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`⚠️ Port ${port} is in use. Trying port ${port + 1}...`);
            port++;
            startServer();
        } else {
            console.error('Server error:', err);
        }
    });
}

startServer();
