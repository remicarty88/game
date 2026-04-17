const express = require('express');
const path = require('path');

const app = express();

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Basic route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🔥 Server running on port ${PORT}`);
    console.log(`🔥 Health check: http://0.0.0.0:${PORT}/health`);
});

