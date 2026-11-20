# Firestore Security Specification (Google Login Access Gate)

## 1. Data Invariants
1. **Default Deny**: Every unspecified Firestore path denies all reads and writes (`match /{document=**}`).
2. **Verified Google Identity**: All reads and writes require a signed-in user with `request.auth.token.email_verified == true`.
3. **PII Isolation**: `/users/{userId}` documents contain PII (`email`, `displayName`, `photoURL`) and are strictly readable only by `isOwner(userId)` or `isAdmin()`. Blanket `list` is forbidden for regular users.
4. **No Self-Assigned Privileges**: A user creating `/users/{userId}` may only set `role: "member"` (unless already verified as `isAdmin()`), and cannot mutate `role`, `uid`, `email`, or `createdAt` on subsequent updates.
5. **Temporal & Structural Integrity**: `createdAt` and `lastLoginAt` must strictly equal `request.time`, all strings enforce explicit `.size()` limits matching `firebase-blueprint.json`, and all document IDs pass `isValidId()`.

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Read**: `get /users/uid-1` with `auth = null`.
2. **Cross-User PII Read**: `get /users/uid-victim` signed in as `uid-attacker`.
3. **Blanket User Enumeration**: `list /users` signed in as non-admin `uid-attacker`.
4. **Unverified Email Spoof**: `create /users/uid-spoof` with `email: "vickeyb7@gmail.com"` and `email_verified: false`.
5. **Identity Spoofing on Create**: `create /users/uid-victim` signed in as `uid-attacker` with `{ uid: "uid-victim", ... }`.
6. **Self-Assigned Admin Escalation**: `create /users/uid-attacker` with `{ role: "admin", ... }`.
7. **Role Escalation via Update**: `update /users/uid-attacker` changing `role` from `"member"` to `"admin"`.
8. **Shadow Field Injection**: `create /users/uid-attacker` including extra ghost field `{ isVerified: true }`.
9. **Immutable Field Tampering**: `update /users/uid-attacker` modifying `createdAt` or `email`.
10. **Client-Forged Timestamp**: `create /users/uid-attacker` with `lastLoginAt` != `request.time`.
11. **Resource Poisoning (Oversized String)**: `update /users/uid-attacker` with `displayName` length > 120 chars or `photoURL` length > 500 chars.
12. **Admin Collection Tampering**: `create /admins/uid-attacker` signed in as non-admin.
