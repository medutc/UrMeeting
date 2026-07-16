const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
    title: { type: String, required: true },
    date: { type: String, required: true },
    time: { type: String, required: true },
    department: { type: String, required: true },
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    invitedUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});

module.exports = mongoose.model('Meeting', meetingSchema);