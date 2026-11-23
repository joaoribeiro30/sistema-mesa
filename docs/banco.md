# Modelo relacional

```mermaid
erDiagram
    USERS ||--o{ RESERVATIONS : cria
    EVENTS ||--o{ SECTORS : contem
    SECTORS ||--o{ TABLES : contem
    EVENTS ||--o{ RESERVATIONS : recebe
    TABLES ||--o{ RESERVATIONS : possui
    RESERVATIONS ||--o{ PAYMENTS : recebe
    PAYMENTS ||--o{ PAYMENT_WEBHOOK_EVENTS : registra
    USERS ||--o| GOOGLE_IDENTITIES : vincula
    USERS ||--o{ ACCOUNT_TOKENS : recebe
    USERS o|--o{ OAUTH_ATTEMPTS : vincula

    USERS {
        uuid id PK
        string email UK
        string password_hash
        UserRole role
        int session_version
        timestamptz email_verified_at
    }
    EVENTS {
        uuid id PK
        string slug UK
        string currency
        EventStatus status
        timestamptz starts_at
        timestamptz ends_at
    }
    SECTORS {
        uuid id PK
        uuid event_id FK
        string name
    }
    TABLES {
        uuid id PK
        uuid sector_id FK
        uuid event_id FK
        int capacity
        int price_minor
        boolean is_enabled
    }
    RESERVATIONS {
        uuid id PK
        uuid user_id FK
        uuid table_id FK
        uuid event_id FK
        uuid idempotency_key
        int guest_count
        int capacity
        int amount_minor
        string currency FK
        ReservationStatus status
        timestamptz expires_at
        string ticket_token UK
    }
    PAYMENTS {
        uuid id PK
        uuid reservation_id FK
        uuid idempotency_key
        string provider
        string provider_payment_id
        int amount_minor FK
        string currency FK
        PaymentStatus status
        PaymentMethod method
    }
    PAYMENT_WEBHOOK_EVENTS {
        string provider PK
        string event_id PK
        uuid payment_id FK
        timestamptz received_at
    }
    GOOGLE_IDENTITIES {
        string subject PK
        uuid user_id FK, UK
    }
    ACCOUNT_TOKENS {
        string token_hash PK
        uuid user_id FK
        AccountTokenKind kind
        timestamptz expires_at
        timestamptz used_at
    }
    OAUTH_ATTEMPTS {
        string state_hash PK
        string browser_hash
        uuid link_user_id FK
        timestamptz expires_at
    }
```

## Restrições de negócio

- As FKs compostas de `tables` e `reservations` garantem que setor, mesa e reserva se refiram ao mesmo evento. A moeda da reserva segue a moeda do evento.
- A FK composta de `payments` exige o mesmo valor e a mesma moeda da reserva. Os valores monetários usam inteiros na menor unidade da moeda. Cada reserva pode ter várias tentativas e no máximo uma liquidação, incluindo uma liquidação já estornada.
- Um índice parcial admite somente uma cobrança de checkout pendente por reserva. A chave composta em `payment_webhook_events` garante a deduplicação por provedor. Uma aprovação tardia é registrada em `REFUND_REQUIRED`; somente uma liquidação elegível confirma a reserva e torna a mesa `SOLD`.
- O índice parcial `reservations_one_active_per_table` admite uma única reserva `PENDING_PAYMENT` ou `CONFIRMED` por mesa. O worker registra `EXPIRED` quando o prazo de pagamento passa. A transação de uma nova reserva também pode expirar o bloqueio vencido antes de inserir outro.
- O bloqueio compartilhado do evento protege a leitura de status, início e moeda. O bloqueio exclusivo da linha da mesa serializa a alocação daquela mesa. Rotinas futuras que bloqueiem ambas as linhas podem usar a mesma ordem, evento antes da mesa.
- As FKs operacionais restringem exclusões que quebrariam o histórico. As FKs de tokens e identidades removem registros de autenticação dependentes quando a conta é excluída.
- O [DDL](../prisma/migrations/20261122000000_initial/migration.sql) contém as chaves compostas, as restrições `CHECK` e os índices parciais. [Índices parciais no PostgreSQL](https://www.postgresql.org/docs/current/indexes-partial.html)
