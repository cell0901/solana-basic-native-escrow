# Solana Native Escrow

A public, permissionless token swap escrow written in native Rust — no Anchor. 
A maker locks token A and specifies how much token B they want. 
Any taker who provides the token B can settle the swap.

## Instructions

**`InitializeOffer`** — maker creates an offer, locks token A into a vault ATA
- data: `token_a_amount: u64`, `token_b_amount: u64`, `offer_id: u64`

**`TakeOffer`** — any taker settles the swap, vault and offer PDA are closed on completion
- rent from vault ATA → taker, rent from offer PDA → maker

## Vault

```
seeds: ["escrow", maker_pubkey, offer_id_le_bytes]
size:  113 bytes (32 + 32 + 32 + 8 + 8 + 1)
```

## Build & Deploy

```bash
cargo build-sbf
solana program deploy target/deploy/escrow.so
```

## TODO

- [ ] LiteSVM tests
- [ ] `CancelOffer` instruction — maker reclaims token A if no taker

