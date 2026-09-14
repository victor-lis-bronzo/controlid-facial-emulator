# WebGUI: Complete User Lifecycle & Facial Photo Management via .fcgi

## Problem Statement

Administrators using the Control-iD embedded WebGUI currently can only view a basic textual list of users and create new ones. They cannot edit existing user data (such as correcting misspelled names or updating access PINs), cannot delete users who should no longer have access, and cannot manage or visually verify facial identification photos. Furthermore, the WebGUI lacks the authentic navigation framework of the physical device, isolating user management in an unbranded, standalone page without clear pathways to other device administrative functions.

## Solution

The WebGUI is enhanced with a complete lifecycle management suite for User entities, paired with an authentic device navigation shell (WebGuiLayout). Administrators can view existing users with their facial photos, edit name, registration, and PIN credentials via a dedicated edit interface, delete users with a safety confirmation prompt, and upload or remove facial photos directly through the official `.fcgi` device protocol. The entire authenticated interface is enclosed within the WebGuiLayout, featuring a persistent sidebar and top bar matching the physical Control-iD reader experience.

## User Stories

1. As an administrator, I want to access the WebGUI through an authentic device navigation layout (WebGuiLayout), so that I experience the familiar interface of the Control-iD hardware.
2. As an administrator, I want to see a persistent sidebar displaying available device modules, so that I understand which sections are currently supported and which are planned.
3. As an administrator, I want the Users module highlighted as active in the sidebar, so that I always know my current location in the WebGUI.
4. As an administrator, I want to view each user's facial photo (User_Photo) directly in the user listing, so that I can quickly recognize registered individuals.
5. As an administrator, I want to see an intuitive placeholder avatar when a user does not have a facial photo registered, so that the interface remains visually balanced and informative.
6. As an administrator, I want to click an "Edit" action on any user row, so that I can open an editor pre-populated with that user's existing name and registration.
7. As an administrator, I want to update a user's name and registration number, so that I can fix typos or organizational changes without recreating the user.
8. As an administrator, I want to optionally set a new numeric password/PIN when editing a user, so that the user's keypad access credential can be updated securely.
9. As an administrator, I want the edit operation to submit changes to the device via `POST /modify_objects.fcgi?object=users`, so that all mutations strictly adhere to the official hardware API.
10. As an administrator, I want to see immediate validation errors in the edit modal if required fields are empty, so that I do not submit invalid data to the device.
11. As an administrator, I want to click a "Delete" action on a user row, so that I can initiate the removal of a user who no longer has permission to access the facility.
12. As an administrator, I want a confirmation modal before deleting a user, so that I do not accidentally delete personnel by mistake.
13. As an administrator, I want the confirmation modal to display the user's name and registration, so that I am completely sure which record I am about to delete.
14. As an administrator, I want user deletion to be dispatched via `POST /destroy_objects.fcgi?object=users`, so that the record is cleanly purged according to the device specification.
15. As an administrator, I want the system to clean up the user's facial photo and any group associations upon deletion, so that no orphaned assets remain on the device storage.
16. As an administrator, I want to upload a JPEG or PNG facial photo for an existing user, so that the physical facial recognition camera can identify the individual.
17. As an administrator, I want photo uploads to be processed via `POST /user_set_image.fcgi`, so that the WebGUI consumes only official device endpoints.
18. As an administrator, I want to see an instant preview of the uploaded photo after a successful upload, so that I can verify that the image is framed and oriented correctly.
19. As an administrator, I want to delete an existing facial photo via `POST /user_destroy_image.fcgi`, so that I can remove an outdated photo without deleting the entire user.
20. As an administrator, I want clear, user-friendly error banners if a photo upload fails (e.g. invalid file format or excessive file size), so that I know how to correct the problem.
21. As an administrator, I want all background requests to automatically carry the active session token, so that I am never unexpectedly logged out during management tasks.
22. As an administrator, I want the user table to refresh smoothly after creating, editing, or deleting a user, so that the displayed data always reflects the current device state.

## Implementation Decisions

- **Navigation Architecture (WebGuiLayout)**:
  - An authenticated structural component containing a top banner with device status/identity and logout button, and a persistent sidebar with navigation links.
  - Displays "Users" as the active route, with inactive placeholder items for future device sections (Groups, Time Zones, Access Rules, Logs, Settings) mirroring the physical Control-iD WebGUI structure.
  - Responsive design adapting to mobile and desktop viewports without horizontal clipping.

- **Backend Protocol Additions (`.fcgi`)**:
  - Implement `POST /user_set_image.fcgi`: Accepts `user_id` in query or multipart payload, extracts image binary (JPEG/PNG), and delegates persistence to `PhotoStorage.save`. Protected by session authentication.
  - Implement `POST /user_destroy_image.fcgi`: Accepts `user_id` in query or payload and calls `PhotoStorage.delete`. Protected by session authentication.
  - Leverage existing `POST /modify_objects.fcgi?object=users`: Accepts `values` containing updated user attributes and `where` filters containing target user ID.
  - Leverage existing `POST /destroy_objects.fcgi?object=users`: Performs user removal and cascades deletion of associated photo files and relational group memberships.

- **Frontend User Management Enhancements**:
  - Avatar rendering: Integrates image display using `<img src="/user_get_image.fcgi?user_id=...&session=...">` with fallback to initials/silhouette avatar when no image exists.
  - User Edit Modal: Form allowing modification of Name, Registration, and optional new PIN, submitting to `/modify_objects.fcgi`.
  - User Delete Confirmation: Dedicated modal with danger confirmation button submitting to `/destroy_objects.fcgi`.
  - Photo Management UI: Photo dropzone / file picker component embedded in user edit view, supporting image preview, upload via `user_set_image.fcgi`, and deletion via `user_destroy_image.fcgi`.

- **Client Interaction & Authentication Invariance**:
  - WebGUI strictly consumes official `.fcgi` routes with session token parameter injection (`?session=...`). No dedicated `/api/...` bypasses allowed for device domain operations.

## Testing Decisions

- **Testing Principles**:
  - Tests must verify observable user behavior through DOM interactions and external HTTP requests, never internal implementation state or private component variables.
  - Existing seams must be utilized at the highest level possible.

- **Frontend Seam (High-Level DOM & Network Mocking)**:
  - User interaction tests using React Testing Library and User Event in the Web workspace.
  - Edit flow: Click edit button -> verify prefilled form -> change inputs -> submit -> assert `POST /modify_objects.fcgi` payload -> assert table refresh.
  - Delete flow: Click delete button -> verify confirmation prompt -> confirm -> assert `POST /destroy_objects.fcgi` payload -> assert user removed from table.
  - Photo flow: File selection -> assert `POST /user_set_image.fcgi` multipart/binary dispatch -> assert updated avatar rendered.
  - Layout test: Verify WebGuiLayout renders sidebar, links, active route highlight, and handles responsive breakdown.

- **Backend Seam (Fastify HTTP Integration)**:
  - Integration tests in the API workspace via `app.inject()`.
  - Verify `POST /user_set_image.fcgi` with authenticated session stores photo and returns success.
  - Verify `POST /user_destroy_image.fcgi` unlinks photo and subsequent `GET /user_get_image.fcgi` returns 404.
  - Verify `POST /destroy_objects.fcgi` cascades and removes user photo from storage.

- **Prior Art**:
  - Frontend: `web/src/users.test.tsx`, `web/src/auth.test.tsx`.
  - Backend: `api/src/routes/fcgi/fcgi.integration.test.ts`, `api/src/routes/admin/admin.integration.test.ts`.

## Out of Scope

- Biometric facial recognition matching algorithm (emulation focuses on protocol and data storage, not optical facial recognition math).
- Managing Access Groups, Portals, and Time Zones inside this slice (these will have dedicated specs following the user lifecycle completion).
- Camera capture directly from the client webcam (file upload of photos is standard for device WebGUI administration).

## Further Notes

- Maintains strict backward compatibility with existing emulation scripts, push engine, and Docker container packaging.
- All code follows the repository conventions: TypeScript ESM with `.js` import specifiers, Tailwind CSS utility styling, Fastify 5 route definitions, and Vitest test runner.
