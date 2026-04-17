const { PeerServer } = require('peerjs');
const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Health check endpoint (before PeerServer)
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// PeerJS server configuration
const peerServer = PeerServer({ 
    port: process.env.PORT || 8080,
    path: '/peerjs',
    allow_discovery: true,
    debug: true
});

// PeerJS events
peerServer.on('connection', (id) => {
    console.log('🔥 Peer connected:', id);
});

peerServer.on('disconnect', (id) => {
    console.log('🔥 Peer disconnected:', id);
});

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🔥 PeerJS server running on port ${PORT}`);
    console.log(`🔥 Health check: http://0.0.0.0:${PORT}/health`);
    console.log(`🔥 PeerJS path: /peerjs`);
});
