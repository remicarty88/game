const express = require('express');
const path = require('path');

console.log('🔥 Starting server...');

const app = express();

// Health check endpoint - самый простой
app.get('/health', (req, res) => {
    console.log('🔥 Health check accessed');
    res.status(200).json({ status: 'ok', message: 'Server is running' });
});

// Root endpoint
app.get('/', (req, res) => {
    console.log('🔥 Root accessed');
    res.status(200).send('88 Games Server is running');
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// 404 handler
app.use((req, res) => {
    console.log('🔥 404 for:', req.path);
    res.status(404).send('Not found');
});

// Start server
const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log('🔥 Server successfully started!');
    console.log(`🔥 Host: ${HOST}`);
    console.log(`🔥 Port: ${PORT}`);
    console.log(`🔥 Health check: http://${HOST}:${PORT}/health`);
    console.log(`🔥 Environment: ${process.env.NODE_ENV || 'development'}`);
});
