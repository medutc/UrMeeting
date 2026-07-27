# UrMeeting

A corporate virtual communication platform engineered to facilitate seamless, real-time meetings and collaboration.

## Overview
UrMeeting provides a robust, scalable architecture for virtual corporate environments. Built with a focus on real-time connectivity and secure authorization, the platform supports role-based access levels to manage meeting environments effectively. Originally developed as part of a professional internship at Roca in Settat, it is designed to optimize internal corporate communications.

## Key Features
*   **Real-Time Communication:** Instant connectivity for seamless virtual meetings powered by Socket.io.
*   **Role-Based Access Control (RBAC):** Tiered access levels to securely manage user permissions, hosts, and standard participants.
*   **Modern Client Architecture:** Responsive and scalable frontend utilizing React and TypeScript.
*   **Secure Authentication:** Integrated user credential encryption and secure session management.
*   **File Handling:** Support for file and asset uploads during sessions.

## Technology Stack
*   **Frontend:** React, TypeScript, HTML5, CSS3
*   **Backend:** Node.js, Express.js
*   **Database:** MongoDB
*   **Real-Time Engine:** Socket.io
*   **Core Dependencies:** `bcryptjs` (hashing), `multer` (file uploads), `cors`, `dotenv`

## Installation and Setup

1.  **Clone the repository:**
    ```bash
    git clone <your-repository-url>
    cd UrMeeting
    ```

2.  **Install dependencies:**
    Ensure you have Node.js installed, then run:
    ```bash
    npm install
    ```

3.  **Environment Configuration:**
    Create a `.env` file in the root directory and configure the necessary environment variables required for your instance:
    ```env
    PORT=3000
    MONGODB_URI=<your_mongodb_connection_string>
    SECRET_KEY=<your_session_secret>
    ```

4.  **Start the server:**
    Run the main database/server file to initialize the backend:
    ```bash
    node db.js
    ```
    *(Alternatively, use `npm start` or `npm run dev` if you have those scripts configured in your `package.json`)*

## Author
**Moataz Mohamed**