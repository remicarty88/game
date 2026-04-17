const { PeerServer } = require('peerjs');
const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);

// PeerJS server configuration
const peerServer = PeerServer({ 
    port: process.env.PORT || 3001,
    path: '/peerjs'
});

// Attach PeerServer to Express app
peerServer.on('connection', (id) => {
    console.log('🔥 Peer connected:', id);
});

peerServer.on('disconnect', (id) => {
    console.log('🔥 Peer disconnected:', id);
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// Health check endpoint for Railway
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Basic route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Railway uses PORT environment variable
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🔥 PeerJS server running on port ${PORT}`);
    console.log(`🔥 WebSocket server ready for voice chat`);
    console.log(`🔥 Access at: http://0.0.0.0:${PORT}`);
});
