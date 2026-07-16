// --- Database Mock Layer (Using localStorage) ---
const STORAGE_KEYS = {
    USERS: 'urmeeting_users',
    MEETINGS: 'urmeeting_meetings'
};

// Initial Seed Data: 5 Admin Accounts (One per Department)
const seedAdmins = [
    { id: 'u1', username: 'admin_ops', password: 'password123', name: 'Operations Admin', role: 'admin', department: 'Operations' },
    { id: 'u2', username: 'admin_sales', password: 'password123', name: 'Sales Admin', role: 'admin', department: 'Sales & Marketing' },
    { id: 'u3', username: 'admin_supply', password: 'password123', name: 'Logistics Admin', role: 'admin', department: 'Supply Chain & Logistics' },
    { id: 'u4', username: 'admin_finance', password: 'password123', name: 'Finance Admin', role: 'admin', department: 'Finance' },
    { id: 'u5', username: 'admin_hr', password: 'password123', name: 'HR Admin', role: 'admin', department: 'Human Resources' }
];

// Load context from local storage, or initialize if empty
function getStoredData(key, defaultData) {
    const data = localStorage.getItem(key);
    if (!data) {
        localStorage.setItem(key, JSON.stringify(defaultData));
        return defaultData;
    }
    return JSON.parse(data);
}

function saveData(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}

// Memory State
let users = getStoredData(STORAGE_KEYS.USERS, seedAdmins);
let meetings = getStoredData(STORAGE_KEYS.MEETINGS, []);
let currentUser = null;

// --- DOM elements ---
const views = {
    login: document.getElementById('login-view'),
    admin: document.getElementById('admin-view'),
    employee: document.getElementById('employee-view')
};

// --- View Router ---
function navigateTo(viewName) {
    Object.keys(views).forEach(v => views[v].classList.add('hidden'));
    views[viewName].classList.remove('hidden');
}

// --- Dynamic Rendering Logics ---

// 1. Render checking options of employees to invite
function renderInviteesList() {
    const listContainer = document.getElementById('invitees-list');
    listContainer.innerHTML = '';
    
    // Admins can invite anyone in the company database except themselves
    const potentialInvitees = users.filter(u => u.id !== currentUser.id);

    if (potentialInvitees.length === 0) {
        listContainer.innerHTML = '<div class="no-data">No other employees registered yet.</div>';
        return;
    }

    potentialInvitees.forEach(user => {
        const item = document.createElement('div');
        item.className = 'checkbox-item';
        item.innerHTML = `
            <input type="checkbox" id="invite-${user.id}" value="${user.id}">
            <label for="invite-${user.id}">${user.name} <span class="badge">${user.department}</span></label>
        `;
        listContainer.appendChild(item);
    });
}

// 2. Render meetings managed by current logged-in Admin
function renderAdminMeetings() {
    const container = document.getElementById('admin-meetings-list');
    container.innerHTML = '';

    const myMeetings = meetings.filter(m => m.creatorId === currentUser.id);

    if (myMeetings.length === 0) {
        container.innerHTML = '<div class="no-data">You have not scheduled any meetings yet.</div>';
        return;
    }

    myMeetings.forEach(meeting => {
        // Resolve invitees names
        const invitedNames = meeting.invitedUserIds.map(id => {
            const found = users.find(u => u.id === id);
            return found ? found.name : 'Unknown';
        }).join(', ');

        const card = document.createElement('div');
        card.className = 'meeting-card';
        card.innerHTML = `
            <h4>${escapeHTML(meeting.title)}</h4>
            <div class="meeting-meta">
                <strong>📅 Date:</strong> ${meeting.date} | 
                <strong>🕒 Time:</strong> ${meeting.time}
            </div>
            <div class="meeting-invitees">
                <strong>Invitees:</strong> ${invitedNames || 'None'}
            </div>
        `;
        container.appendChild(card);
    });
}

// 3. Render invitations visible only to the Employee
function renderEmployeeMeetings() {
    const container = document.getElementById('emp-meetings-list');
    container.innerHTML = '';

    // Filter meetings where user id is in the invited list
    const myInvitations = meetings.filter(m => m.invitedUserIds.includes(currentUser.id));

    if (myInvitations.length === 0) {
        container.innerHTML = '<div class="no-data">No upcoming meetings scheduled for you. Enjoy your day!</div>';
        return;
    }

    myInvitations.forEach(meeting => {
        // Locate Host details
        const host = users.find(u => u.id === m => m.id === meeting.creatorId) || { name: 'Admin', department: meeting.department };
        const hostName = users.find(u => u.id === meeting.creatorId)?.name || 'Admin';

        const card = document.createElement('div');
        card.className = 'meeting-card';
        card.innerHTML = `
            <h4>${escapeHTML(meeting.title)}</h4>
            <div class="meeting-meta">
                <strong>📅 Date:</strong> ${meeting.date} | 
                <strong>🕒 Time:</strong> ${meeting.time} <br>
                <strong>Host:</strong> ${hostName} (${meeting.department} Department)
            </div>
        `;
        container.appendChild(card);
    });
}

// --- Action Handlers ---

// Form: Sign In
document.getElementById('login-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const uName = document.getElementById('username').value.trim();
    const uPass = document.getElementById('password').value;
    const errorEl = document.getElementById('login-error');

    const foundUser = users.find(u => u.username === uName && u.password === uPass);

    if (foundUser) {
        currentUser = foundUser;
        errorEl.classList.add('hidden');
        this.reset();

        if (currentUser.role === 'admin') {
            // Setup admin page configuration elements
            document.getElementById('admin-display-name').textContent = currentUser.name;
            document.getElementById('admin-display-dept').textContent = currentUser.department;
            document.getElementById('emp-dept-readonly').value = currentUser.department;
            
            renderInviteesList();
            renderAdminMeetings();
            navigateTo('admin');
        } else {
            // Setup employee view configurations
            document.getElementById('emp-display-name').textContent = currentUser.name;
            document.getElementById('emp-display-dept').textContent = currentUser.department;
            
            renderEmployeeMeetings();
            navigateTo('employee');
        }
    } else {
        errorEl.classList.remove('hidden');
    }
});

// Form: Create Employee (Admin action)
document.getElementById('create-employee-form').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const name = document.getElementById('emp-name').value.trim();
    const username = document.getElementById('emp-username').value.trim();
    const password = document.getElementById('emp-password').value;
    const department = currentUser.department; // Hardlocked to current Admin's department

    // Check unique username constraint
    if (users.some(u => u.username === username)) {
        alert('This username is already taken. Please choose another.');
        return;
    }

    const newEmployee = {
        id: 'u_' + Date.now(),
        username,
        password,
        name,
        role: 'employee',
        department
    };

    users.push(newEmployee);
    saveData(STORAGE_KEYS.USERS, users);

    alert(`Successfully registered account for ${name}!`);
    this.reset();
    document.getElementById('emp-dept-readonly').value = currentUser.department; // keep pre-filled
    
    // Refresh invitees display on the admin UI
    renderInviteesList();
});

// Form: Create Meeting (Admin action)
document.getElementById('create-meeting-form').addEventListener('submit', function(e) {
    e.preventDefault();

    const title = document.getElementById('meet-title').value.trim();
    const date = document.getElementById('meet-date').value;
    const time = document.getElementById('meet-time').value;

    // Build array of selected invitees checks
    const invitedUserIds = [];
    document.querySelectorAll('#invitees-list input[type="checkbox"]:checked').forEach(cb => {
        invitedUserIds.push(cb.value);
    });

    if (invitedUserIds.length === 0) {
        alert('Please select at least one invitee for the meeting.');
        return;
    }

    const newMeeting = {
        id: 'm_' + Date.now(),
        title,
        date,
        time,
        creatorId: currentUser.id,
        department: currentUser.department,
        invitedUserIds
    };

    meetings.push(newMeeting);
    saveData(STORAGE_KEYS.MEETINGS, meetings);

    alert('Meeting successfully scheduled and invitations sent.');
    this.reset();
    renderAdminMeetings();
});

// Logouts
document.getElementById('admin-logout').addEventListener('click', handleLogout);
document.getElementById('emp-logout').addEventListener('click', handleLogout);

function handleLogout() {
    currentUser = null;
    navigateTo('login');
}

// Utility: Prevent XSS
function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}
