const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');

const User = require('./models/User');
const Meeting = require('./models/Meeting');
// Add this near your other middleware in app.js
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);
const app = express();
app.use(bodyParser.json());
app.use(express.static('public')); // Place your index.html in a 'public' folder

const SECRET_KEY = "urmeeting_super_secret_key"; 

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/urmeeting')
  .then(() => console.log("Connected to MongoDB"))
  .catch(err => console.error("Database connection error:", err));

// Middleware to verify logged-in user
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(403).send("A token is required for authentication");
  try {
    const decoded = jwt.verify(token.split(" ")[1], SECRET_KEY);
    req.user = decoded;
  } catch (err) {
    return res.status(401).send("Invalid Token");
  }
  return next();
};

// Route: Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  
  if (user && (await bcrypt.compare(password, user.password))) {
    const token = jwt.sign({ user_id: user._id, role: user.role, department: user.department }, SECRET_KEY, { expiresIn: "2h" });
    return res.status(200).json({ token, role: user.role, department: user.department });
  }
  res.status(400).send("Invalid Credentials");
});

// Route: Admin creates a new employee in their department
app.post('/users', verifyToken, async (req, res) => {
  if (req.user.role !== 'Admin') return res.status(403).send("Only Admins can create users.");
  
  const { username, password } = req.body;
  const encryptedPassword = await bcrypt.hash(password, 10);
  
  const newUser = await User.create({
    username,
    password: encryptedPassword,
    role: 'Employee',
    department: req.user.department // Forces the employee into the admin's department
  });
  
  res.status(201).json(newUser);
});

// Route: Admin creates a meeting and invites employees
app.post('/meetings', verifyToken, async (req, res) => {
  if (req.user.role !== 'Admin') return res.status(403).send("Only Admins can create meetings.");
  
  const { title, date, attendees } = req.body;
  
  const meeting = await Meeting.create({
    title,
    date,
    department: req.user.department,
    createdBy: req.user.user_id,
    attendees 
  });
  
  res.status(201).json(meeting);
});

// Route: Get meetings for the logged-in user
app.get('/meetings', verifyToken, async (req, res) => {
  let meetings;
  if (req.user.role === 'Admin') {
    // Admins see meetings they created
    meetings = await Meeting.find({ createdBy: req.user.user_id }).populate('attendees', 'username');
  } else {
    // Employees see meetings they are invited to
    meetings = await Meeting.find({ attendees: req.user.user_id }).populate('createdBy', 'username');
  }
  res.status(200).json(meetings);
});

app.listen(3000, () => {
  console.log('UrMeeting Server running on port 3000');
});