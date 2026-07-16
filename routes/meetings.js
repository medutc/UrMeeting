const express = require('express');
const Meeting = require('../models/Meeting');
const auth = require('../middleware/auth');

const router = express.Router();

// POST: Create a new meeting (Admin only)
router.post('/create', auth, async (req, res) => {
    try {
        // 1. Verify admin status
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Access denied. Admins only.' });
        }

        const { title, date, attendeeIds } = req.body;

        // 2. Create the meeting, locking it to the admin's department
        const meeting = new Meeting({
            title,
            date,
            department: req.user.department, 
            createdBy: req.user._id,
            attendees: attendeeIds // This should be an array of employee ObjectIds
        });

        await meeting.save();
        res.status(201).json({ message: 'Meeting scheduled successfully', meeting });

    } catch (error) {
        res.status(500).json({ error: 'Server error while creating meeting' });
    }
});

// GET: View all department meetings (Admin only)
router.get('/department', auth, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Access denied.' });
        }

        // Fetch meetings for this specific department and populate attendee details
        const meetings = await Meeting.find({ department: req.user.department })
            .populate('attendees', 'name email')
            .populate('createdBy', 'name');

        res.json(meetings);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// GET: View meetings an employee is invited to (Open to all authenticated users)
router.get('/my-invites', auth, async (req, res) => {
    try {
        // Find meetings where this user's ID exists in the attendees array
        const meetings = await Meeting.find({ attendees: req.user._id })
            .populate('createdBy', 'name email department') // Show who invited them
            .select('-attendees'); // Hide the full attendee list from normal employees

        res.json(meetings);
    } catch (error) {
        res.status(500).json({ error: 'Server error while fetching invites' });
    }
});

module.exports = router;