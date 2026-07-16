const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Meeting = require('./models/Meeting');

const app = express();
app.use(cors());
app.use(express.json()); // Parses incoming JSON requests

const JWT_SECRET = 'your_super_secret_key_change_in_production';

// 1. Database Connection
mongoose.connect('mongodb://localhost:27017/urmeeting', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("Connected to MongoDB"))
  .catch(err => console.error("MongoDB connection error:", err));

// --- MIDDLEWARE: Verify JWT Token ---
const authenticate = (req, res, next) => {
    const token = req.header('Authorization')?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access denied' });
    try {
        const verified = jwt.verify(token, JWT_SECRET);
        req.user = verified;
        next();
    } catch (err) {
        res.status(400).json({ error: 'Invalid token' });
    }
};

// --- API ROUTES ---

// Auth: Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'User not found' });

    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) return res.status(400).json({ error: 'Invalid password' });

    // Generate a token containing the user's ID and role
    const token = jwt.sign({ id: user._id, role: user.role, department: user.department }, JWT_SECRET);
    res.json({ token, user: { id: user._id, name: user.name, role: user.role, department: user.department } });
});

// Admin: Create Employee
app.post('/api/employees', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Requires admin privileges' });
    
    try {
        // Hash the password before saving
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(req.body.password, salt);

        const newUser = new User({
            username: req.body.username,
            password: hashedPassword,
            name: req.body.name,
            role: 'employee',
            department: req.user.department // Lock to admin's department
        });

        const savedUser = await newUser.save();
        res.status(201).json({ message: 'Employee created successfully' });
    } catch (error) {
        res.status(400).json({ error: 'Username might already exist' });
    }
});

// Admin: Create Meeting
app.post('/api/meetings', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Requires admin privileges' });

    const newMeeting = new Meeting({
        title: req.body.title,
        date: req.body.date,
        time: req.body.time,
        department: req.user.department,
        creatorId: req.user.id,
        invitedUserIds: req.body.invitedUserIds
    });

    await newMeeting.save();
    res.status(201).json(newMeeting);
});

// User/Admin: Get Meetings
app.get('/api/meetings', authenticate, async (req, res) => {
    if (req.user.role === 'admin') {
        // Admin sees meetings they created
        const meetings = await Meeting.find({ creatorId: req.user.id }).populate('invitedUserIds', 'name');
        res.json(meetings);
    } else {
        // Employee sees meetings they are invited to
        const meetings = await Meeting.find({ invitedUserIds: req.user.id }).populate('creatorId', 'name department');
        res.json(meetings);
    }
});

app.listen(3000, () => console.log('Server running on port 3000'));