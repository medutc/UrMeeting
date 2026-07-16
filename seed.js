const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

mongoose.connect('mongodb://localhost:27017/urmeeting')
  .then(() => console.log("Connected to MongoDB"))
  .catch(err => console.error(err));

async function seedAdmin() {
  try {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await User.create({
      username: 'admin_hr',
      password: hashedPassword,
      role: 'Admin',
      department: 'Human Resources'
    });
    console.log("First Admin created successfully!");
  } catch (error) {
    console.error("Error seeding database:", error);
  } finally {
    process.exit();
  }
}

seedAdmin();