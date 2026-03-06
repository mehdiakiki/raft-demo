# Architecture Diagrams (Drafts)

These are first-pass Mermaid drafts for user-facing documentation.
They are intentionally simple and can be refined later for style and depth.

## 1) System Context

```mermaid
flowchart LR
    subgraph Cluster[Raft Cluster]
      A[Node A]
      B[Node B]
      C[Node C]
      D[Node D]
      E[Node E]
    end

    G[Gateway]
    F[Frontend UI]
    U[User]

    A -->|PushState / PushRpc (gRPC)| G
    B -->|PushState / PushRpc (gRPC)| G
    C -->|PushState / PushRpc (gRPC)| G
    D -->|PushState / PushRpc (gRPC)| G
    E -->|PushState / PushRpc (gRPC)| G

    G -->|WebSocket stream| F
    U -->|Browser interaction| F
    F -->|REST control API| G
    G -->|SetAlive / SubmitCommand (gRPC)| Cluster
```

## 2) Container / Component Diagram

```mermaid
flowchart TB
    subgraph Core[raft-core]
      N1[Raft Node]
      OBS[RPC Observers]
      PUSH[Pusher]
      N1 --> OBS --> PUSH
    end

    subgraph GW[raft-demo gateway]
      RX[StateReceiver]
      HUB[WebSocket Hub]
      CACHE[(latestState cache)]
      NC[NodeClientMap]

      RX --> HUB
      RX --> CACHE
      CACHE --> HUB
      RX --> NC
    end

    subgraph FE[raft-demo frontend]
      WS[useRaft WebSocket handler]
      RECON[RaftStateReconstructor]
      LEDGER[Vote Ledger + Dedupe]
      UI[Canvas + Sidebar]
      WS --> RECON
      WS --> LEDGER
      RECON --> UI
      LEDGER --> UI
    end

    PUSH -->|PushState / PushRpc| RX
    HUB -->|WS messages| WS
    UI -->|commands/kill/restart| RX
```

## 3) Sequence: Leader Failover

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Frontend
    participant GW as Gateway
    participant L as Old Leader
    participant C as Candidate Node
    participant P as Peer Nodes

    U->>FE: Kill leader
    FE->>GW: POST /api/nodes/{id}/kill
    GW->>L: SetAlive(false)

    Note over C,P: Election timeout expires
    C->>P: PRE_VOTE
    P-->>C: PRE_VOTE_REPLY (grant/deny)
    C->>P: REQUEST_VOTE
    P-->>C: VOTE_REPLY (grant/deny)

    C->>GW: PushState(CANDIDATE/LEADER)
    C->>GW: PushRpc(PRE_VOTE / REQUEST_VOTE / replies)
    GW-->>FE: WS state/rpc stream
    FE-->>U: Animate packets + update node states
```

## 4) Sequence: Command Roundtrip

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Frontend
    participant GW as Gateway
    participant N as Raft Node(s)

    U->>FE: Submit command (SET/DELETE/JSON)
    FE->>FE: encodeUserCommand()
    FE->>GW: POST /api/commands
    GW->>N: SubmitCommand(request)

    alt Non-leader reply with leader hint
        N-->>GW: success=false, leader_id=...
        GW->>N: Retry to hinted leader
    end

    N-->>GW: SubmitCommandReply
    GW-->>FE: JSON result (success, committed, duplicate, ...)
    FE-->>U: Command status banner
```

## 5) Data Contract Diagram

```mermaid
classDiagram
    class RaftStateEvent {
      +string node_id
      +string state
      +int64 current_term
      +string voted_for
      +int64 event_time_ms
      +int64 commit_index
      +string leader_id
      +int64 heartbeat_interval_ms
      +int64 election_timeout_ms
    }

    class RaftRpcEvent {
      +string from_node
      +string to_node
      +string rpc_type
      +int64 event_time_ms
      +string rpc_id
      +int64? term
      +string? candidate_id
      +bool? vote_granted
      +string? direction
    }

    class RpcEventPayload {
      +type = "rpc"
      +from_node
      +to_node
      +rpc_type
      +event_time_ms
      +rpc_id
      +term?
      +candidate_id?
      +vote_granted?
      +direction?
    }

    RaftRpcEvent --> RpcEventPayload : gateway passthrough
```

## 6) State Reconstruction Flow

```mermaid
flowchart TD
    M[Incoming WS message] --> T{message.type == rpc?}
    T -- No --> S[Apply state event]
    S --> R[RaftStateReconstructor.applyEvent]
    R --> UI1[Render nodes/roles/timers]

    T -- Yes --> D[Direction gate: SEND only]
    D --> K[Dedupe by rpc_id]
    K --> RT{rpc_type}

    RT -- APPEND_ENTRIES --> HB[Add heartbeat packet]
    HB --> ARR{Packet arrived?}
    ARR -- Yes --> HR[applyHeartbeat(to_node)]
    HR --> UI1

    RT -- PRE_VOTE / PRE_VOTE_REPLY --> PM[Animate pre-vote packets]
    PM --> UI2[Render packet trail]

    RT -- REQUEST_VOTE --> RV[Animate request vote packet]
    RV --> SV[Seed candidate self-vote]
    SV --> UI2

    RT -- VOTE_REPLY --> VR[Animate vote reply packet]
    VR --> VL[Update vote ledger]
    VL --> VT[Derive candidate tally]
    VT --> UI3[Render tally/quorum status]
```

## 7) Reconnect Replay

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant GW as Gateway Hub

    FE->>GW: Open WebSocket
    GW-->>FE: Replay cached latestState for node A
    GW-->>FE: Replay cached latestState for node B
    GW-->>FE: Replay cached latestState for node C
    GW-->>FE: ... (deterministic node-id order)
    GW-->>FE: Continue live stream (state + rpc)

    FE->>FE: Reconstruct cluster baseline
    FE->>FE: Apply dedupe for rpc_id
```

## 8) Troubleshooting Decision Tree

```mermaid
flowchart TD
    A[Not seeing expected election animation?] --> B{Pre-vote packets missing?}
    B -- Yes --> C[Check raft-core branch/image has pre-vote emitter changes]
    C --> D[Rebuild raft-core-node image]
    D --> E[Restart stack and hard-refresh browser]
    E --> F[Check gateway logs for PRE_VOTE / PRE_VOTE_REPLY]

    B -- No --> G{Vote tally wrong or duplicated?}
    G -- Yes --> H[Verify rpc_id present in gateway payload]
    H --> I[Confirm canonical send stream and dedupe behavior]
    I --> J[Check VOTE_REPLY vote_granted/candidate_id fields]

    G -- No --> K{Timeout resets too early?}
    K -- Yes --> L[Verify follower reset occurs on heartbeat arrival]
    L --> M[Check frontend heartbeat animation timing]

    K -- No --> N[Check websocket connectivity and replay state]
```

