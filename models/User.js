const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // Will store the hashed password
    name: { type: String, required: true },
    role: { type: String, enum: ['admin', 'employee'], default: 'employee' },
    department: { type: String, required: true }
});

module.exports = mongoose.model('User', userSchema);