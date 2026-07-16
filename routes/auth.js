const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// POST: Login Route (Open to everyone)
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Check if user exists
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ error: 'Invalid email or password.' });
        }

        // Validate password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid email or password.' });
        }

        // Generate JWT with user's ID, role, and department
        const token = jwt.sign(
            { _id: user._id, role: user.role, department: user.department },
            'your_jwt_secret',
            { expiresIn: '24h' }
        );

        res.json({ token, message: 'Logged in successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// POST: Register Employee (Restricted to Admins)
router.post('/register-employee', auth, async (req, res) => {
    try {
        // 1. Verify the requester is an admin
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Access denied. Admins only.' });
        }

        const { name, email, password } = req.body;

        // Check if email is already taken
        let existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'User already registered.' });
        }

        // 2. Create the new employee, forcing their department to match the admin's department
        const employee = new User({
            name,
            email,
            password,
            department: req.user.department, // Locked to the admin's department
            role: 'employee'
        });

        await employee.save();

        res.status(201).json({ 
            message: 'Employee created successfully.',
            employee: { name: employee.name, department: employee.department } 
        });

    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;