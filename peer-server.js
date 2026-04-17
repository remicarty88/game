const { PeerServer } = require('peerjs');
const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Health check endpoint (before PeerServer to ensure it's accessible)
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Basic route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// PeerJS server configuration - attach to existing HTTP server
const peerServer = PeerServer({ 
    port: process.env.PORT || 3001,
    path: '/peerjs',
    allow_discovery: true
});

// Attach PeerServer to Express HTTP server
peerServer.attach(server);

// PeerJS events
peerServer.on('connection', (id) => {
    console.log('🔥 Peer connected:', id);
});

peerServer.on('disconnect', (id) => {
    console.log('🔥 Peer disconnected:', id);
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🔥 Server running on port ${PORT}`);
    console.log(`🔥 Health check: http://0.0.0.0:${PORT}/health`);
    console.log(`🔥 PeerJS path: /peerjs`);
});
