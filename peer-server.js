const { ExpressPeerServer } = require('express-peerjs');
const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);

// PeerJS server configuration
const peerServer = ExpressPeerServer(server, {
    debug: true,
    path: '/peerjs',
    allow_discovery: true,
    port: 3001
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// Use PeerJS server
app.use('/peerjs', peerServer);

// Basic route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`🔥 PeerJS server running on port ${PORT}`);
    console.log(`🔥 WebSocket server ready for voice chat`);
});
