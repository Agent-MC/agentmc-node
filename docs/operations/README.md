# AgentMC API Operation Docs

Generated from `spec/openapi.filtered.json`.

| Operation ID | Method | Path | Tags |
| --- | --- | --- | --- |
| [agentHeartbeat](./agentHeartbeat.md) | POST | `/agents/heartbeat` | Agents |
| [authenticateAgentRealtimeSocket](./authenticateAgentRealtimeSocket.md) | POST | `/agents/realtime/sessions/{session}/socket-auth` | Agents |
| [claimAgentRealtimeSession](./claimAgentRealtimeSession.md) | POST | `/agents/realtime/sessions/{session}/claim` | Agents |
| [closeAgentRealtimeSession](./closeAgentRealtimeSession.md) | POST | `/agents/realtime/sessions/{session}/close` | Agents |
| [commentCalendarItem](./commentCalendarItem.md) | POST | `/calendar/items/{item}/comments` | Calendar |
| [createAgentBrief](./createAgentBrief.md) | POST | `/briefs` | Briefs |
| [createAgentRealtimeSignal](./createAgentRealtimeSignal.md) | POST | `/agents/realtime/sessions/{session}/signals` | Agents |
| [createBoard](./createBoard.md) | POST | `/boards` | Boards |
| [createBoardColumn](./createBoardColumn.md) | POST | `/boards/{board}/columns` | Boards |
| [createCalendarItem](./createCalendarItem.md) | POST | `/calendar/items` | Calendar |
| [createTask](./createTask.md) | POST | `/tasks` | Tasks |
| [createTaskComment](./createTaskComment.md) | POST | `/tasks/{task}/comments` | Tasks |
| [deleteAgentBrief](./deleteAgentBrief.md) | DELETE | `/briefs/{id}` | Briefs |
| [deleteBoard](./deleteBoard.md) | DELETE | `/boards/{id}` | Boards |
| [deleteBoardColumn](./deleteBoardColumn.md) | DELETE | `/boards/{board}/columns` | Boards |
| [deleteCalendarItem](./deleteCalendarItem.md) | DELETE | `/calendar/items/{item}` | Calendar |
| [deleteTask](./deleteTask.md) | DELETE | `/tasks/{task}` | Tasks |
| [deleteTaskComment](./deleteTaskComment.md) | DELETE | `/tasks/{task}/comments/{comment}` | Tasks |
| [getAgentInstructions](./getAgentInstructions.md) | GET | `/agents/instructions` | Agents |
| [listAgentBriefs](./listAgentBriefs.md) | GET | `/briefs` | Briefs |
| [listAgentRealtimeRequestedSessions](./listAgentRealtimeRequestedSessions.md) | GET | `/agents/realtime/sessions/requested` | Agents |
| [listAgentRealtimeSignals](./listAgentRealtimeSignals.md) | GET | `/agents/realtime/sessions/{session}/signals` | Agents |
| [listAgents](./listAgents.md) | GET | `/teams/agents` | Teams |
| [listBoards](./listBoards.md) | GET | `/boards` | Boards |
| [listCalendar](./listCalendar.md) | GET | `/calendar` | Calendar |
| [listHosts](./listHosts.md) | GET | `/hosts` | Hosts |
| [listLogs](./listLogs.md) | GET | `/logs` | Logs |
| [listNotifications](./listNotifications.md) | GET | `/notifications` | Notifications |
| [listTaskComments](./listTaskComments.md) | GET | `/tasks/{task}/comments` | Tasks |
| [listTasks](./listTasks.md) | GET | `/tasks` | Tasks |
| [listTeamMembers](./listTeamMembers.md) | GET | `/team/members` | Teams |
| [markAllNotificationsRead](./markAllNotificationsRead.md) | POST | `/notifications/read-all` | Notifications |
| [markNotificationRead](./markNotificationRead.md) | PATCH | `/notifications/{notification}/read` | Notifications |
| [showBoard](./showBoard.md) | GET | `/boards/{id}` | Boards |
| [showCalendarItem](./showCalendarItem.md) | GET | `/calendar/items/{item}` | Calendar |
| [showHost](./showHost.md) | GET | `/hosts/{id}` | Hosts |
| [showTask](./showTask.md) | GET | `/tasks/{task}` | Tasks |
| [updateAgentBrief](./updateAgentBrief.md) | PATCH | `/briefs/{id}` | Briefs |
| [updateBoard](./updateBoard.md) | PATCH | `/boards/{id}` | Boards |
| [updateBoardColumn](./updateBoardColumn.md) | PATCH | `/boards/{board}/columns` | Boards |
| [updateCalendarItem](./updateCalendarItem.md) | PUT | `/calendar/items/{item}` | Calendar |
| [updateTask](./updateTask.md) | PATCH | `/tasks/{task}` | Tasks |
| [updateTaskComment](./updateTaskComment.md) | PATCH | `/tasks/{task}/comments/{comment}` | Tasks |
