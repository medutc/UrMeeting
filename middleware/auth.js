const jwt = require('jsonwebtoken');

module.exports = function(req, res, next) {
    // Expecting the token in the header as: "Bearer <token>"
    const authHeader = req.header('Authorization');
    if (!authHeader) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        // In a real app, store 'your_jwt_secret' in a .env file
        const decoded = jwt.verify(token, 'your_jwt_secret');
        req.user = decoded; 
        next();
    } catch (ex) {
        res.status(400).json({ error: 'Invalid token.' });
    }
};