# @agentmc/api

## 0.3.37

### Patch Changes

- API Update

## 0.3.36

### Patch Changes

- API Update

## 0.3.35

### Patch Changes

- API Update

## 0.3.34

### Patch Changes

- API Update

## 0.3.33

### Patch Changes

- API Update

## 0.3.32

### Patch Changes

- API Update

## 0.3.31

### Patch Changes

- API Update

## 0.3.30

### Patch Changes

- API Updates

## 0.3.29

### Patch Changes

- API Update

## 0.3.28

### Patch Changes

- API Update

## 0.3.27

### Patch Changes

- API Update

## 0.3.26

### Patch Changes

- API Update

## 0.3.25

### Patch Changes

- API Update

## 0.3.24

### Patch Changes

- API Update

## 0.3.23

### Patch Changes

- API Update

## 0.3.22

### Patch Changes

- API Update

## 0.3.21

### Patch Changes

- API Update

## 0.3.20

### Patch Changes

- API Update

## 0.3.19

### Patch Changes

- API Update

## 0.3.18

### Patch Changes

- API Update

## 0.3.17

### Patch Changes

- API Update

## 0.3.16

### Patch Changes

- API Update

## 0.3.15

### Patch Changes

- API Update

## 0.3.14

### Patch Changes

- API Update

## 0.3.13

### Patch Changes

- API Updates

## 0.3.12

### Patch Changes

- API Updates

## 0.3.11

### Patch Changes

- Bridge realtime notification events into the OpenClaw Agent runtime action loop so notifications can trigger AgentMC AI actions like chat does.

  Adds configurable runtime controls:

  - `bridgeNotificationsToAi` (default `true`)
  - `bridgeReadNotifications` (default `false`)
  - `bridgeNotificationTypes` (optional type filter)
  - `onNotificationBridge` callback for run telemetry

## 0.3.10

### Patch Changes

- API Update

## 0.3.9

### Patch Changes

- API Updates

## 0.3.8

### Patch Changes

- API Update

## 0.3.7

### Patch Changes

- API Update

## 0.3.6

### Patch Changes

- API Update

## 0.3.5

### Patch Changes

- API Update

## 0.3.4

### Patch Changes

- API Update

## 0.3.3

### Patch Changes

- API Update

## 0.3.2

### Patch Changes

- API Updates

## 0.3.1

### Patch Changes

- API Updates

## 0.3.0

### Minor Changes

- d127615: Add a built-in realtime notification subscription helper for agent sessions.

  New SDK capability:

  - `client.subscribeToRealtimeNotifications(...)`
  - exported `subscribeToRealtimeNotifications(...)` helper

  The helper claims requested sessions, authenticates websocket channel subscriptions, and surfaces callbacks for:

  - raw realtime signals
  - notification events
  - task assignment events
  - connection state and error handling

  Also adds docs/examples and a new `pusher-js` dependency for websocket transport.

## 0.2.10

### Patch Changes

- API Update

## 0.2.9

### Patch Changes

- API Update

## 0.2.8

### Patch Changes

- API Update

## 0.2.7

### Patch Changes

- API Update

## 0.2.6

### Patch Changes

- Api update

## 0.2.5

### Patch Changes

- API Update

## 0.2.4

### Patch Changes

- API Update

## 0.2.3

### Patch Changes

- API Update

## 0.2.2

### Patch Changes

- Update API

## 0.2.1

### Patch Changes

- Update API

## 0.2.0

### Minor Changes

- 60c7bcb: Initial open-source release of the AgentMC API SDK, docs, and CLI generated from OpenAPI.
