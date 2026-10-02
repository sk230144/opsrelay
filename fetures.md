## Project: **OpsRelay — Real-Time Hotel Operations & Incident Management**

Think of it as a mobile command center for hotels/restaurants. Staff use it to report operational problems, hand over unresolved work between shifts, and coordinate maintenance/housekeeping in real time.

A staff member could report:

> Room 402 AC not working → High priority → Maintenance → attach photo → assigned to technician → technician updates status → manager gets notified → issue resolved.

That gives you much more engineering depth than a basic CRUD app.

### Main features

- **Role-based authentication**
  - Staff
  - Supervisor
  - Manager
  - JWT + refresh tokens
  - SecureStore for mobile credentials

- **Incident / Task Management**
  - Create incident
  - Category: Maintenance / Housekeeping / Guest Request / Safety
  - Priority: Low / Medium / High / Critical
  - Attach photos
  - Assign employee
  - Add notes/comments
  - Status flow:
    `Reported → Assigned → In Progress → Review → Resolved`

- **QR Scanner**
  
  Put QR codes on rooms/equipment.

  Employee scans:

  `ROOM-402`

  App automatically loads:

  `Room 402 → Previous incidents → Current open issues → Report new issue`

  This is a great mobile-specific feature to demo.

- **Real-time updates**

Use Socket.IO/WebSockets.

If another employee updates an incident:

> 🔔 Room 402 AC issue has been assigned to you.

And the task updates on screen without refreshing.

- **Shift Handover**

At the end of a shift:

```text
Shift Handover
-----------------------
3 unresolved issues

🔴 Room 402 - AC failure
🟡 Kitchen - Freezer inspection
🟢 Lobby - Light replacement

Notes:
Guest in Room 402 requested update before 9 PM.
```

The next shift can acknowledge the handover.

- **Offline-first architecture**

This is where the project becomes impressive.

If internet disappears:

```text
Incident created
↓
Stored locally
↓
Added to sync queue
↓
Internet returns
↓
Automatically POST to API
↓
Local temporary ID replaced with server ID
```

Show a small indicator:

> 3 changes waiting to sync

This demonstrates much more than normal API integration.

- **Push notifications**

Using Expo Notifications / Firebase:

```text
Critical incident reported
Task assigned to you
Incident overdue
Manager requested review
```

- **SLA timer**

Example:

```text
CRITICAL
Room 402 - AC Failure

Resolve within: 30 min

Remaining
00:18:42
```

If overdue, automatically escalate it to the supervisor.

### Architecture

I would use:

```text
Mobile
React Native + TypeScript
Expo
Expo Router
Zustand
TanStack Query
React Hook Form
Zod
SecureStore
SQLite
Expo Camera / QR Scanner
Push Notifications

Backend
FastAPI
PostgreSQL
SQLAlchemy
JWT
WebSockets
Background Jobs

Storage
Supabase Storage / S3
```

Architecture:

```text
React Native App
       │
       ├── REST API
       │
       ▼
    FastAPI
       │
       ├── PostgreSQL
       ├── Object Storage
       └── WebSocket Server
                │
                ▼
         Real-time updates


Mobile
  │
  ├── SQLite cache
  │
  └── Offline Sync Queue
          │
          ▼
      API when online
```

### Important screens

You only need around **8 polished screens**:

```text
Login

Operations Dashboard

Incidents
   ├── Open
   ├── Assigned to Me
   └── Critical

Incident Details

Create Incident

QR Scanner

Shift Handover

Notifications

Profile
```

Your dashboard could show:

```text
Good Morning, Saurabh

Today's Operations

Critical       2
Open           14
Assigned       5
Resolved       21

------------------------

🔴 Room 402
AC not functioning
18 min remaining

🟡 Kitchen
Freezer temperature check
Assigned to Rahul

------------------------

3 offline changes waiting to sync
```

## One particularly strong feature

Build **optimistic UI + conflict resolution**.

Imagine two people edit the same incident while one device is offline.

Your sync engine detects:

```text
Local version: 4
Server version: 5

Conflict detected
```

Then show:

```text
This incident was changed by another employee.

Server:
Status: In Progress
Assigned: Rahul

Your Change:
Status: Resolved

[Keep Server Version]
[Use My Version]
```

That is the kind of feature that gives you something technical to discuss with their architect.

## What you can tell NexBrix in the interview

> I wanted to demonstrate more than basic React Native screens, so I built an offline-first operations application. It supports JWT authentication, REST APIs, WebSocket updates, QR scanning, image uploads, push notifications, role-based workflows and an offline synchronization queue. I focused especially on failure handling and state consistency because those are important in real mobile applications.

Then you can actually **turn Wi-Fi off during the demo**, create an incident, turn Wi-Fi back on, and show it syncing.