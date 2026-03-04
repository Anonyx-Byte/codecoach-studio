# Design Document: CodeCoach Security and UX Improvements

## Overview

This design addresses critical security vulnerabilities and user experience enhancements for CodeCoach Studio, an AI-powered coding mentor web application. The system consists of a React frontend (TypeScript, Vite) and Node.js/Express backend with JSON file-based persistence.

The improvements fall into two categories:

1. **Security Hardening (Priority 1)**: Protect sensitive configuration files, validate environment setup, implement database backups, and enhance code execution safety warnings.

2. **UX Enhancements (Priority 2)**: Replace static loading states with animations, improve error handling with toast notifications, add onboarding flow, implement keyboard shortcuts, and optimize mobile responsiveness.

The design maintains backward compatibility with existing functionality while adding defensive layers and polish for a hackathon presentation.

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     React Frontend                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Toast System │  │ Skeleton     │  │ Onboarding   │     │
│  │              │  │ Loaders      │  │ System       │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Keyboard     │  │ Code         │  │ Performance  │     │
│  │ Shortcuts    │  │ Executor     │  │ Metrics      │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ HTTPS/REST API
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Node.js/Express Backend                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Environment  │  │ Database     │  │ Security     │     │
│  │ Validator    │  │ Backup       │  │ Headers      │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │ Rate         │  │ Input        │                        │
│  │ Limiter      │  │ Validation   │                        │
│  └──────────────┘  └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                  ┌──────────────────┐
                  │ JSON Database    │
                  │ + Backups        │
                  └──────────────────┘
```

### Technology Stack

**Frontend:**
- React 19.2.0 with TypeScript
- Vite build system
- Monaco Editor for code editing
- Web Workers for code execution

**Backend:**
- Node.js with Express 5.2.1
- File-based JSON storage
- dotenv for configuration
- AWS SDK / Groq for AI services

### Security Layers

1. **Configuration Protection**: .gitignore rules, environment validation
2. **Data Protection**: Automatic backups with rotation
3. **Runtime Protection**: Rate limiting, input validation, security headers
4. **Execution Safety**: Web Worker sandboxing, timeout enforcement, user warnings

## Components and Interfaces

### 1. Git Ignore Configuration

**Purpose**: Prevent sensitive files from being committed to version control.

**Files Modified**:
- `codecoach/.gitignore`
- Backend workspace root `.gitignore` (create if missing)

**Additions**:
```gitignore
# Environment files
.env
.env.local
.env.*.local

# Database and backups
backend/data/
```

### 2. Environment Validator (Backend)

**Purpose**: Validate critical environment variables on startup to fail fast with clear errors.

**Location**: `backend/validateEnv.js` (new file)

**Interface**:
```javascript
/**
 * Validates environment configuration on startup
 * @throws {Error} If validation fails with descriptive message
 */
function validateEnvironment() {
  // Validate AUTH_SECRET exists and is strong
  // Validate AUTH_SECRET is not default value
  // Validate required AI provider credentials
}

module.exports = { validateEnvironment };
```

**Validation Rules**:
- AUTH_SECRET must be at least 32 characters
- AUTH_SECRET cannot be "replace_with_a_random_64_char_secret"
- AUTH_SECRET should contain mix of alphanumeric and special characters
- If AI_PROVIDER=groq, GROQ_API_KEY must be set
- If AI_PROVIDER=bedrock, AWS credentials must be set

**Integration**: Called in `backend/index.js` before server starts listening.

### 3. Database Backup System (Backend)

**Purpose**: Automatically backup database before writes with rotation to prevent data loss.

**Location**: `backend/backupManager.js` (new file)

**Interface**:
```javascript
/**
 * Creates a timestamped backup of the database file
 * @param {string} dbPath - Path to database file
 * @returns {Promise<string>} Path to created backup
 */
async function createBackup(dbPath) {
  // Copy dbPath to backups/app-db-{ISO_TIMESTAMP}.json
  // Return backup path
}

/**
 * Rotates backups, keeping only the N most recent
 * @param {string} backupDir - Directory containing backups
 * @param {number} maxBackups - Maximum number of backups to retain (default: 5)
 * @returns {Promise<number>} Number of backups deleted
 */
async function rotateBackups(backupDir, maxBackups = 5) {
  // List all backup files
  // Sort by timestamp (newest first)
  // Delete files beyond maxBackups
}

/**
 * Restores a backup to the active database location
 * @param {string} backupPath - Path to backup file
 * @param {string} dbPath - Path to active database file
 * @returns {Promise<void>}
 */
async function restoreBackup(backupPath, dbPath) {
  // Validate backup exists
  // Copy backup to dbPath
}

module.exports = { createBackup, rotateBackups, restoreBackup };
```

**Backup Strategy**:
- Backups stored in `backend/data/backups/`
- Filename format: `app-db-YYYY-MM-DDTHH-mm-ss.sssZ.json`
- Automatic rotation keeps 5 most recent backups
- Backup created before every `writeDb()` call
- Failures logged but don't block writes

**Integration**: Modify `writeDb()` function in `backend/index.js` to call `createBackup()` before writing.

### 4. Code Execution Warning System (Frontend)

**Purpose**: Provide clear warnings about code execution risks before users run code.

**Location**: Modify `codecoach/src/App.tsx`

**Components**:

**Warning Banner**:
```tsx
<div className="code-execution-warning">
  <span className="warning-icon">⚠️</span>
  <div className="warning-content">
    <strong>Code Execution Warning</strong>
    <p>Code runs in your browser with a 5-second timeout. Avoid infinite loops and untrusted code.</p>
  </div>
</div>
```

**Confirmation Dialog**:
```tsx
// Before runCodePreview() executes
const confirmed = window.confirm(
  "Run this code in your browser? It will execute with a 5-second timeout. " +
  "Avoid infinite loops and untrusted code."
);
if (!confirmed) return;
```

**Timeout Display**: Show "Timeout: 5s" near the Run Code button.

### 5. Toast Notification System (Frontend)

**Purpose**: Display non-blocking, auto-dismissing notifications for errors and success messages.

**Location**: `codecoach/src/components/Toast.tsx` (new file)

**Interface**:
```tsx
type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  duration?: number; // milliseconds, default 5000
}

interface ToastProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export default function ToastContainer({ toasts, onDismiss }: ToastProps) {
  // Render toasts in fixed position (top-right or bottom-right)
  // Auto-dismiss after duration
  // Support manual dismiss
  // Animate in/out
}
```

**Toast Manager Hook**:
```tsx
// Location: codecoach/src/hooks/useToast.ts
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  
  const showToast = (message: string, type: ToastType, options?: Partial<Toast>) => {
    // Add toast with unique ID
    // Auto-remove after duration
  };
  
  const dismissToast = (id: string) => {
    // Remove toast by ID
  };
  
  return { toasts, showToast, dismissToast };
}
```

**Integration**: Replace `setErrorMessage()` calls with `showToast()` throughout App.tsx.

### 6. Skeleton Loader System (Frontend)

**Purpose**: Replace "Loading..." text with animated skeleton placeholders.

**Location**: `codecoach/src/components/SkeletonLoader.tsx` (new file)

**Interface**:
```tsx
interface SkeletonProps {
  variant: "text" | "rect" | "circle";
  width?: string | number;
  height?: string | number;
  count?: number; // For multiple lines
  className?: string;
}

export default function Skeleton({ variant, width, height, count, className }: SkeletonProps) {
  // Render animated skeleton based on variant
  // Use CSS animation for shimmer effect
}
```

**Usage Patterns**:
- Replace "Loading..." in results panel with skeleton blocks
- Replace "Explaining..." button text with spinner
- Show skeleton cards while analytics load

### 7. Onboarding System (Frontend)

**Purpose**: Guide first-time users through key features with progressive disclosure.

**Location**: `codecoach/src/components/Onboarding.tsx` (new file)

**Interface**:
```tsx
interface OnboardingStep {
  id: string;
  target: string; // CSS selector for element to highlight
  title: string;
  content: string;
  position: "top" | "bottom" | "left" | "right";
}

interface OnboardingProps {
  steps: OnboardingStep[];
  onComplete: () => void;
  onSkip: () => void;
}

export default function OnboardingOverlay({ steps, onComplete, onSkip }: OnboardingProps) {
  // Show overlay with spotlight on target element
  // Display tooltip with step content
  // Navigate through steps
  // Store completion in localStorage
}
```

**Onboarding Steps**:
1. Welcome message and overview
2. Code editor - "Paste your code here"
3. Explain button - "Click to get AI analysis"
4. Results panel - "View structured explanations"
5. Quiz Studio button - "Generate practice quizzes"
6. Keyboard shortcuts hint - "Press Ctrl+? for shortcuts"

**Trigger**: Check `localStorage.getItem("codecoach-onboarding-completed")` on mount.

### 8. Keyboard Shortcuts System (Frontend)

**Purpose**: Provide keyboard shortcuts for common actions to improve power user efficiency.

**Location**: Modify `codecoach/src/App.tsx`

**Shortcuts**:
- `Ctrl+Enter` / `Cmd+Enter`: Trigger code explanation
- `Escape`: Close any open modal
- `Ctrl+?` / `Cmd+?`: Show keyboard shortcuts help modal

**Implementation**:
```tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Ctrl+Enter or Cmd+Enter
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleExplain();
    }
    
    // Escape
    if (e.key === "Escape") {
      // Close modals in priority order
      if (quizModalOpen) setQuizModalOpen(false);
      else if (flashcardsOpen) setFlashcardsOpen(false);
      else if (askOpen) setAskOpen(false);
      else if (analyticsOpen) setAnalyticsOpen(false);
      else if (authModalOpen) setAuthModalOpen(false);
    }
    
    // Ctrl+? or Cmd+?
    if ((e.ctrlKey || e.metaKey) && e.key === "?") {
      e.preventDefault();
      setShortcutsModalOpen(true);
    }
  };
  
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [/* dependencies */]);
```

**Shortcuts Help Modal**: Display all available shortcuts in a modal.

### 9. Performance Metrics Display (Frontend)

**Purpose**: Show AI response times and confidence scores more prominently.

**Location**: Modify `codecoach/src/App.tsx`

**Enhancements**:
- Track request start/end time for AI operations
- Display response time in milliseconds next to results
- Add "Fast mode" / "Detailed mode" toggle (UI only, backend unchanged)
- Enhance backend health indicator with color-coded status and last check time

**Implementation**:
```tsx
const [requestStartTime, setRequestStartTime] = useState<number | null>(null);
const [responseTime, setResponseTime] = useState<number | null>(null);

async function handleExplain() {
  setRequestStartTime(Date.now());
  // ... existing logic ...
  setResponseTime(Date.now() - requestStartTime);
}

// Display in results header
{responseTime && (
  <span className="response-time">
    Response time: {responseTime}ms
  </span>
)}
```

### 10. Mobile Responsive Enhancements (Frontend)

**Purpose**: Optimize layout for tablet and mobile devices.

**Location**: Modify `codecoach/src/App.css` and `codecoach/src/index.css`

**Breakpoints**:
```css
/* Tablet: 768px - 1024px */
@media (max-width: 1024px) {
  /* Stack editor and results vertically */
  /* Increase button sizes for touch */
  /* Simplify toolbar layout */
}

/* Mobile: < 768px */
@media (max-width: 768px) {
  /* Full-width layout */
  /* Collapsible sections */
  /* Bottom navigation */
}
```

**Touch Targets**: Ensure all interactive elements are at least 44x44px.

**Layout Changes**:
- Switch from horizontal split to vertical stack on tablets
- Collapsible results panel on mobile
- Simplified toolbar with hamburger menu on mobile

## Data Models

### Environment Configuration

```typescript
// backend/.env
interface BackendEnv {
  PORT: number;
  NODE_ENV: "development" | "production";
  AUTH_SECRET: string; // Min 32 chars, validated on startup
  AUTH_TOKEN_TTL_MS: number;
  ENFORCE_HTTPS: boolean;
  CORS_ORIGIN: string;
  AI_PROVIDER: "groq" | "bedrock";
  AI_MODEL?: string;
  AI_TIMEOUT_MS: number;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  GROQ_TIMEOUT_MS?: number;
  AWS_REGION?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_SESSION_TOKEN?: string;
  BEDROCK_MODEL_ID?: string;
}

// codecoach/.env
interface FrontendEnv {
  VITE_API_BASE_URL: string;
}
```

### Backup Metadata

```typescript
interface BackupFile {
  filename: string; // Format: app-db-YYYY-MM-DDTHH-mm-ss.sssZ.json
  path: string;
  timestamp: Date;
  size: number; // bytes
}

interface BackupManifest {
  backups: BackupFile[];
  maxBackups: number;
  lastRotation: Date;
}
```

### Toast Notification

```typescript
interface Toast {
  id: string; // UUID
  type: "success" | "error" | "info" | "warning";
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  duration: number; // milliseconds, default 5000
  createdAt: Date;
}
```

### Onboarding State

```typescript
interface OnboardingState {
  completed: boolean;
  currentStep: number;
  skipped: boolean;
  completedAt?: Date;
}

// Stored in localStorage as "codecoach-onboarding-state"
```

### Performance Metrics

```typescript
interface PerformanceMetrics {
  requestStartTime: number; // timestamp
  responseTime: number; // milliseconds
  operation: "explain" | "quiz" | "ask" | "grade";
  success: boolean;
  errorMessage?: string;
}
```

### Keyboard Shortcut

```typescript
interface KeyboardShortcut {
  key: string;
  modifiers: ("ctrl" | "meta" | "shift" | "alt")[];
  description: string;
  action: () => void;
  category: "navigation" | "editing" | "help";
}
```

## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Sensitive Files Excluded from Version Control

*For any* sensitive file path (backend/.env, codecoach/.env, backend/data/), the corresponding .gitignore file should contain an entry that excludes it from version control.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: AUTH_SECRET Length Validation

*For any* AUTH_SECRET value with length less than 32 characters, the backend startup validation should fail with a descriptive error message.

**Validates: Requirements 2.1, 2.3**

### Property 3: Database Backup Before Write

*For any* database write operation, a backup file should exist in backend/data/backups/ with a timestamp before the write occurred.

**Validates: Requirements 3.1**

### Property 4: Backup Filename Format

*For any* backup file created, the filename should match the ISO 8601 timestamp format (app-db-YYYY-MM-DDTHH-mm-ss.sssZ.json) and be located in backend/data/backups/.

**Validates: Requirements 3.2**

### Property 5: Backup Rotation Limit

*For any* state of the backup directory after a backup operation, there should be at most 5 backup files present.

**Validates: Requirements 3.3**

### Property 6: Backup Restore Round Trip

*For any* valid backup file, restoring it to the active database location and then reading the database should produce the same data as the backup contained.

**Validates: Requirements 3.4**

### Property 7: Backup Failure Resilience

*For any* backup operation failure, the system should log the error and continue with the database write operation without throwing an exception.

**Validates: Requirements 3.6**

### Property 8: Code Execution Confirmation Required

*For any* attempt to execute code via the runCodePreview function, a confirmation dialog should be displayed before the Web Worker is created.

**Validates: Requirements 4.2**

### Property 9: Code Execution Timeout Enforcement

*For any* code execution that runs longer than 5 seconds, the Web Worker should be terminated and an error message indicating timeout should be displayed.

**Validates: Requirements 4.3**

### Property 10: Loading State Indicators

*For any* loading state (content loading, AI operations, async operations), the UI should display an appropriate loading indicator (skeleton loader, progress indicator, or spinner) instead of static text.

**Validates: Requirements 5.1, 5.3, 5.4**

### Property 11: Loading Animation Performance

*For any* loading animation, the animation duration should complete within 300 milliseconds.

**Validates: Requirements 5.5**

### Property 12: Error Toast Display

*For any* error that occurs in the application, a toast notification should be displayed with a user-friendly message that does not contain technical stack traces.

**Validates: Requirements 6.1, 6.3**

### Property 13: Failed Request Retry Option

*For any* failed network request, the error toast should include a retry button that allows the user to reattempt the operation.

**Validates: Requirements 6.2**

### Property 14: Error Recovery Suggestions

*For any* error with a known solution (e.g., offline backend, invalid credentials), the error message should include specific recovery steps.

**Validates: Requirements 6.4**

### Property 15: Toast Auto-Dismiss Behavior

*For any* toast notification without action buttons, it should automatically dismiss after 5 seconds; toasts with action buttons should remain until manually dismissed.

**Validates: Requirements 6.5**

### Property 16: Tooltip Display on Hover

*For any* key feature element with a tooltip, hovering over the element should display the tooltip with an explanation.

**Validates: Requirements 7.3**

### Property 17: Interactive Element Hover Effects

*For any* interactive element (buttons, links, inputs), hovering should trigger a visible hover effect (color change, scale, shadow, or ripple).

**Validates: Requirements 8.1, 8.2, 8.3**

### Property 18: Color Contrast Accessibility

*For any* text element and its background color combination in the UI, the contrast ratio should meet WCAG AA standards (4.5:1 for normal text, 3:1 for large text).

**Validates: Requirements 8.4**

### Property 19: Keyboard Focus Visibility

*For any* focusable element that receives keyboard focus, a visible focus indicator (outline, border, or highlight) should be displayed.

**Validates: Requirements 8.5**

### Property 20: Performance Metrics Display

*For any* AI response received, the UI should display the response time in milliseconds and confidence score (if available) prominently in the results area.

**Validates: Requirements 9.1, 9.2, 9.5**

### Property 21: Modal Escape Key Closure

*For any* open modal, pressing the Escape key should close the modal.

**Validates: Requirements 10.2**

### Property 22: Keyboard Shortcut Non-Interference

*For any* custom keyboard shortcut, it should call preventDefault() to avoid interfering with browser default behaviors.

**Validates: Requirements 10.5**

### Property 23: Responsive Layout Optimization

*For any* viewport width between 768px and 1024px, the layout should adapt to a tablet-optimized view with appropriate spacing and element sizing.

**Validates: Requirements 11.2**

### Property 24: Touch Target Minimum Size

*For any* interactive element (buttons, links, inputs), the clickable/touchable area should be at least 44x44 pixels.

**Validates: Requirements 11.3**

### Property 25: Mobile Navigation Accessibility

*For any* viewport width less than 768px, the navigation should be accessible through a mobile-friendly menu (hamburger or bottom navigation).

**Validates: Requirements 11.4**

## Error Handling

### Backend Error Handling

**Environment Validation Errors**:
- Fail fast on startup with clear error messages
- Log validation failures to console with remediation steps
- Exit with non-zero status code to prevent misconfigured deployment

**Backup Operation Errors**:
- Log backup failures but continue with database writes
- Include error details in logs for debugging
- Do not block user operations due to backup failures

**Database Errors**:
- Catch and log file system errors (permissions, disk space)
- Return 500 status with generic error message to client
- Preserve existing database file if write fails

### Frontend Error Handling

**Network Errors**:
- Display toast notification with retry button
- Distinguish between offline, timeout, and server errors
- Provide specific guidance for each error type

**Code Execution Errors**:
- Catch and display syntax errors before execution
- Show runtime errors in the output panel
- Terminate infinite loops with timeout message

**UI Errors**:
- Catch React errors with error boundaries
- Display fallback UI with error message
- Log errors to console for debugging

**Toast Notification Errors**:
- Limit maximum number of simultaneous toasts (5)
- Queue additional toasts if limit reached
- Ensure toasts don't block critical UI elements

## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests for comprehensive coverage:

**Unit Tests**: Verify specific examples, edge cases, and error conditions
- Specific gitignore entries exist
- Default AUTH_SECRET value is rejected
- Specific keyboard shortcuts trigger correct actions
- Documentation files exist with required content
- Onboarding appears on first visit
- Specific UI elements are present

**Property-Based Tests**: Verify universal properties across all inputs
- Any AUTH_SECRET under 32 characters fails validation
- Any database write creates a backup
- Any backup operation maintains 5-file limit
- Any code execution over 5 seconds times out
- Any error displays a toast notification
- Any interactive element meets 44x44px minimum size

Together, these approaches provide comprehensive coverage: unit tests catch concrete bugs in specific scenarios, while property tests verify general correctness across the input space.

### Testing Configuration

**Property-Based Testing Library**: Use `fast-check` for JavaScript/TypeScript property-based testing.

**Test Configuration**:
- Minimum 100 iterations per property test
- Each property test must reference its design document property
- Tag format: `Feature: codecoach-security-and-ux-improvements, Property {number}: {property_text}`

**Example Property Test**:
```typescript
// Feature: codecoach-security-and-ux-improvements, Property 2: AUTH_SECRET Length Validation
import fc from 'fast-check';

test('AUTH_SECRET under 32 characters fails validation', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 0, maxLength: 31 }),
      (shortSecret) => {
        const result = validateAuthSecret(shortSecret);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('at least 32 characters');
      }
    ),
    { numRuns: 100 }
  );
});
```

### Backend Testing

**Environment Validation Tests**:
- Unit test: Default AUTH_SECRET value is rejected
- Property test: Any AUTH_SECRET under 32 characters fails
- Unit test: Missing required AI provider credentials fail
- Unit test: Valid configuration passes validation

**Backup System Tests**:
- Property test: Any database write creates a backup
- Property test: Backup filenames match ISO 8601 format
- Property test: Backup rotation maintains 5-file limit
- Property test: Restore round-trip preserves data
- Unit test: Backup failure logs error and continues
- Unit test: Restore with invalid backup path fails gracefully

**Integration Tests**:
- Test full backup/write/restore cycle
- Test startup with various environment configurations
- Test backup rotation with multiple rapid writes

### Frontend Testing

**Toast Notification Tests**:
- Property test: Any error displays a toast
- Property test: Toasts without actions auto-dismiss after 5s
- Unit test: Toast with action button doesn't auto-dismiss
- Unit test: Maximum 5 toasts displayed simultaneously
- Property test: Toast messages don't contain stack traces

**Keyboard Shortcut Tests**:
- Unit test: Ctrl+Enter triggers explanation
- Unit test: Escape closes modals
- Unit test: Ctrl+? opens shortcuts help
- Property test: All shortcuts call preventDefault()

**Loading State Tests**:
- Property test: Any loading state shows indicator
- Property test: Loading animations complete within 300ms
- Unit test: Skeleton loaders replace "Loading..." text

**Accessibility Tests**:
- Property test: All text/background combinations meet WCAG AA
- Property test: All interactive elements are 44x44px minimum
- Property test: All focusable elements show focus indicators
- Unit test: Keyboard navigation works without mouse

**Responsive Design Tests**:
- Property test: Layout adapts for 768-1024px viewports
- Unit test: Mobile navigation appears below 768px
- Unit test: Touch targets meet minimum size on mobile

**Code Execution Tests**:
- Unit test: Confirmation dialog appears before execution
- Property test: Code over 5 seconds times out
- Unit test: Warning banner is visible
- Unit test: Timeout duration is displayed

### Visual Regression Testing

Use visual regression testing tools (e.g., Percy, Chromatic) to verify:
- Skeleton loaders render correctly
- Toast notifications appear in correct position
- Modal animations are smooth
- Hover effects are visible
- Focus indicators are prominent
- Mobile layouts are optimized

### End-to-End Testing

Use Playwright or Cypress for critical user flows:
- First-time user sees onboarding
- Code execution with confirmation
- Error handling with retry
- Keyboard shortcuts work correctly
- Mobile navigation is functional

### Documentation Testing

Verify documentation completeness:
- .env.example files contain security warnings
- AUTH_SECRET generation process is documented
- Backup/restore process is documented
- Code execution security limitations are documented
- API key rotation process is documented

## Implementation Notes

### Security Considerations

1. **Never log sensitive values**: Ensure AUTH_SECRET, API keys, and passwords are never logged
2. **Backup encryption**: Consider encrypting backups if they contain sensitive user data
3. **Rate limiting**: Existing rate limiting should remain in place
4. **Input validation**: Existing validation should remain in place
5. **CORS**: Maintain existing CORS configuration

### Performance Considerations

1. **Backup performance**: Backups are synchronous but should be fast for small JSON files
2. **Animation performance**: Use CSS transforms and opacity for smooth 60fps animations
3. **Toast queue**: Limit simultaneous toasts to prevent memory issues
4. **Skeleton loaders**: Use CSS animations instead of JavaScript for better performance

### Accessibility Considerations

1. **Screen readers**: Ensure toast notifications are announced
2. **Keyboard navigation**: All features must be keyboard accessible
3. **Focus management**: Modals should trap focus and restore on close
4. **Color contrast**: Verify all color combinations meet WCAG AA
5. **Touch targets**: Ensure 44x44px minimum for mobile users

### Browser Compatibility

- Target modern browsers (Chrome, Firefox, Safari, Edge)
- Test Web Worker support (required for code execution)
- Test CSS Grid and Flexbox support (required for responsive layout)
- Provide fallbacks for older browsers where possible

### Deployment Considerations

1. **Environment validation**: Fails deployment if misconfigured
2. **Backup directory**: Ensure backend/data/backups/ is created on first run
3. **Git history cleanup**: Provide clear instructions for removing committed .env files
4. **API key rotation**: Document process for rotating exposed keys
5. **Database migration**: No schema changes, backward compatible

## Future Enhancements

The following enhancements are out of scope for this iteration but may be considered in the future:

1. **Backup encryption**: Encrypt backups at rest
2. **Remote backups**: Store backups in cloud storage (S3, GCS)
3. **Backup scheduling**: Automated periodic backups independent of writes
4. **Advanced onboarding**: Interactive tutorials with code examples
5. **Telemetry**: Track feature usage and performance metrics
6. **Offline mode**: Service worker for offline functionality
7. **Progressive Web App**: Install as native app
8. **Multi-language UI**: Internationalization beyond explanation language
9. **Theme customization**: User-defined color schemes
10. **Advanced keyboard shortcuts**: Customizable shortcuts


A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Sensitive Files Excluded from Version Control

*For any* sensitive file path (backend/.env, codecoach/.env, backend/data/), the corresponding .gitignore file should contain an entry that excludes it from version control.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: AUTH_SECRET Length Validation

*For any* AUTH_SECRET value with length less than 32 characters, the backend startup validation should fail with a descriptive error message.

**Validates: Requirements 2.1, 2.3**

### Property 3: Database Backup Before Write

*For any* database write operation, a backup file should exist in backend/data/backups/ with a timestamp before the write occurred.

**Validates: Requirements 3.1**

### Property 4: Backup Filename Format

*For any* backup file created, the filename should match the ISO 8601 timestamp format (app-db-YYYY-MM-DDTHH-mm-ss.sssZ.json) and be located in backend/data/backups/.

**Validates: Requirements 3.2**

### Property 5: Backup Rotation Limit

*For any* state of the backup directory after a backup operation, there should be at most 5 backup files present.

**Validates: Requirements 3.3**

### Property 6: Backup Restore Round Trip

*For any* valid backup file, restoring it to the active database location and then reading the database should produce the same data as the backup contained.

**Validates: Requirements 3.4**

### Property 7: Backup Failure Resilience

*For any* backup operation failure, the system should log the error and continue with the database write operation without throwing an exception.

**Validates: Requirements 3.6**

### Property 8: Code Execution Confirmation Required

*For any* attempt to execute code via the runCodePreview function, a confirmation dialog should be displayed before the Web Worker is created.

**Validates: Requirements 4.2**

### Property 9: Code Execution Timeout Enforcement

*For any* code execution that runs longer than 5 seconds, the Web Worker should be terminated and an error message indicating timeout should be displayed.

**Validates: Requirements 4.3**

### Property 10: Loading State Indicators

*For any* loading state (content loading, AI operations, async operations), the UI should display an appropriate loading indicator (skeleton loader, progress indicator, or spinner) instead of static text.

**Validates: Requirements 5.1, 5.3, 5.4**

### Property 11: Loading Animation Performance

*For any* loading animation, the animation duration should complete within 300 milliseconds.

**Validates: Requirements 5.5**

### Property 12: Error Toast Display

*For any* error that occurs in the application, a toast notification should be displayed with a user-friendly message that does not contain technical stack traces.

**Validates: Requirements 6.1, 6.3**

### Property 13: Failed Request Retry Option

*For any* failed network request, the error toast should include a retry button that allows the user to reattempt the operation.

**Validates: Requirements 6.2**

### Property 14: Error Recovery Suggestions

*For any* error with a known solution (e.g., offline backend, invalid credentials), the error message should include specific recovery steps.

**Validates: Requirements 6.4**

### Property 15: Toast Auto-Dismiss Behavior

*For any* toast notification without action buttons, it should automatically dismiss after 5 seconds; toasts with action buttons should remain until manually dismissed.

**Validates: Requirements 6.5**

### Property 16: Tooltip Display on Hover

*For any* key feature element with a tooltip, hovering over the element should display the tooltip with an explanation.

**Validates: Requirements 7.3**

### Property 17: Interactive Element Hover Effects

*For any* interactive element (buttons, links, inputs), hovering should trigger a visible hover effect (color change, scale, shadow, or ripple).

**Validates: Requirements 8.1, 8.2, 8.3**

### Property 18: Color Contrast Accessibility

*For any* text element and its background color combination in the UI, the contrast ratio should meet WCAG AA standards (4.5:1 for normal text, 3:1 for large text).

**Validates: Requirements 8.4**

### Property 19: Keyboard Focus Visibility

*For any* focusable element that receives keyboard focus, a visible focus indicator (outline, border, or highlight) should be displayed.

**Validates: Requirements 8.5**

### Property 20: Performance Metrics Display

*For any* AI response received, the UI should display the response time in milliseconds and confidence score (if available) prominently in the results area.

**Validates: Requirements 9.1, 9.2, 9.5**

### Property 21: Modal Escape Key Closure

*For any* open modal, pressing the Escape key should close the modal.

**Validates: Requirements 10.2**

### Property 22: Keyboard Shortcut Non-Interference

*For any* custom keyboard shortcut, it should call preventDefault() to avoid interfering with browser default behaviors.

**Validates: Requirements 10.5**

### Property 23: Responsive Layout Optimization

*For any* viewport width between 768px and 1024px, the layout should adapt to a tablet-optimized view with appropriate spacing and element sizing.

**Validates: Requirements 11.2**

### Property 24: Touch Target Minimum Size

*For any* interactive element (buttons, links, inputs), the clickable/touchable area should be at least 44x44 pixels.

**Validates: Requirements 11.3**

### Property 25: Mobile Navigation Accessibility

*For any* viewport width less than 768px, the navigation should be accessible through a mobile-friendly menu (hamburger or bottom navigation).

**Validates: Requirements 11.4**

## Error Handling

### Backend Error Handling

**Environment Validation Errors**:
- Fail fast on startup with clear error messages
- Log validation failures to console with remediation steps
- Exit with non-zero status code to prevent misconfigured deployment

**Backup Operation Errors**:
- Log backup failures but continue with database writes
- Include error details in logs for debugging
- Do not block user operations due to backup failures

**Database Errors**:
- Catch and log file system errors (permissions, disk space)
- Return 500 status with generic error message to client
- Preserve existing database file if write fails

### Frontend Error Handling

**Network Errors**:
- Display toast notification with retry button
- Distinguish between offline, timeout, and server errors
- Provide specific guidance for each error type

**Code Execution Errors**:
- Catch and display syntax errors before execution
- Show runtime errors in the output panel
- Terminate infinite loops with timeout message

**UI Errors**:
- Catch React errors with error boundaries
- Display fallback UI with error message
- Log errors to console for debugging

**Toast Notification Errors**:
- Limit maximum number of simultaneous toasts (5)
- Queue additional toasts if limit reached
- Ensure toasts don't block critical UI elements

## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests for comprehensive coverage:

**Unit Tests**: Verify specific examples, edge cases, and error conditions
- Specific gitignore entries exist
- Default AUTH_SECRET value is rejected
- Specific keyboard shortcuts trigger correct actions
- Documentation files exist with required content
- Onboarding appears on first visit
- Specific UI elements are present

**Property-Based Tests**: Verify universal properties across all inputs
- Any AUTH_SECRET under 32 characters fails validation
- Any database write creates a backup
- Any backup operation maintains 5-file limit
- Any code execution over 5 seconds times out
- Any error displays a toast notification
- Any interactive element meets 44x44px minimum size

Together, these approaches provide comprehensive coverage: unit tests catch concrete bugs in specific scenarios, while property tests verify general correctness across the input space.

### Testing Configuration

**Property-Based Testing Library**: Use `fast-check` for JavaScript/TypeScript property-based testing.

**Test Configuration**:
- Minimum 100 iterations per property test
- Each property test must reference its design document property
- Tag format: `Feature: codecoach-security-and-ux-improvements, Property {number}: {property_text}`

**Example Property Test**:
```typescript
// Feature: codecoach-security-and-ux-improvements, Property 2: AUTH_SECRET Length Validation
import fc from 'fast-check';

test('AUTH_SECRET under 32 characters fails validation', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 0, maxLength: 31 }),
      (shortSecret) => {
        const result = validateAuthSecret(shortSecret);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('at least 32 characters');
      }
    ),
    { numRuns: 100 }
  );
});
```

### Backend Testing

**Environment Validation Tests**:
- Unit test: Default AUTH_SECRET value is rejected
- Property test: Any AUTH_SECRET under 32 characters fails
- Unit test: Missing required AI provider credentials fail
- Unit test: Valid configuration passes validation

**Backup System Tests**:
- Property test: Any database write creates a backup
- Property test: Backup filenames match ISO 8601 format
- Property test: Backup rotation maintains 5-file limit
- Property test: Restore round-trip preserves data
- Unit test: Backup failure logs error and continues
- Unit test: Restore with invalid backup path fails gracefully

**Integration Tests**:
- Test full backup/write/restore cycle
- Test startup with various environment configurations
- Test backup rotation with multiple rapid writes

### Frontend Testing

**Toast Notification Tests**:
- Property test: Any error displays a toast
- Property test: Toasts without actions auto-dismiss after 5s
-omizable shortcuts
loud storage (S3, GCS)
3. **Backup scheduling**: Automated periodic backups independent of writes
4. **Advanced onboarding**: Interactive tutorials with code examples
5. **Telemetry**: Track feature usage and performance metrics
6. **Offline mode**: Service worker for offline functionality
7. **Progressive Web App**: Install as native app
8. **Multi-language UI**: Internationalization beyond explanation language
9. **Theme customization**: User-defined color schemes
10. **Advanced keyboard shortcuts**: Cust. **Backup directory**: Ensure backend/data/backups/ is created on first run
3. **Git history cleanup**: Provide clear instructions for removing committed .env files
4. **API key rotation**: Document process for rotating exposed keys
5. **Database migration**: No schema changes, backward compatible

## Future Enhancements

The following enhancements are out of scope for this iteration but may be considered in the future:

1. **Backup encryption**: Encrypt backups at rest
2. **Remote backups**: Store backups in cus and restore on close
4. **Color contrast**: Verify all color combinations meet WCAG AA
5. **Touch targets**: Ensure 44x44px minimum for mobile users

### Browser Compatibility

- Target modern browsers (Chrome, Firefox, Safari, Edge)
- Test Web Worker support (required for code execution)
- Test CSS Grid and Flexbox support (required for responsive layout)
- Provide fallbacks for older browsers where possible

### Deployment Considerations

1. **Environment validation**: Fails deployment if misconfigured
2hronous but should be fast for small JSON files
2. **Animation performance**: Use CSS transforms and opacity for smooth 60fps animations
3. **Toast queue**: Limit simultaneous toasts to prevent memory issues
4. **Skeleton loaders**: Use CSS animations instead of JavaScript for better performance

### Accessibility Considerations

1. **Screen readers**: Ensure toast notifications are announced
2. **Keyboard navigation**: All features must be keyboard accessible
3. **Focus management**: Modals should trap focdocumented

## Implementation Notes

### Security Considerations

1. **Never log sensitive values**: Ensure AUTH_SECRET, API keys, and passwords are never logged
2. **Backup encryption**: Consider encrypting backups if they contain sensitive user data
3. **Rate limiting**: Existing rate limiting should remain in place
4. **Input validation**: Existing validation should remain in place
5. **CORS**: Maintain existing CORS configuration

### Performance Considerations

1. **Backup performance**: Backups are sync## End-to-End Testing

Use Playwright or Cypress for critical user flows:
- First-time user sees onboarding
- Code execution with confirmation
- Error handling with retry
- Keyboard shortcuts work correctly
- Mobile navigation is functional

### Documentation Testing

Verify documentation completeness:
- .env.example files contain security warnings
- AUTH_SECRET generation process is documented
- Backup/restore process is documented
- Code execution security limitations are documented
- API key rotation process is e Execution Tests**:
- Unit test: Confirmation dialog appears before execution
- Property test: Code over 5 seconds times out
- Unit test: Warning banner is visible
- Unit test: Timeout duration is displayed

### Visual Regression Testing

Use visual regression testing tools (e.g., Percy, Chromatic) to verify:
- Skeleton loaders render correctly
- Toast notifications appear in correct position
- Modal animations are smooth
- Hover effects are visible
- Focus indicators are prominent
- Mobile layouts are optimized

# test: Skeleton loaders replace "Loading..." text

**Accessibility Tests**:
- Property test: All text/background combinations meet WCAG AA
- Property test: All interactive elements are 44x44px minimum
- Property test: All focusable elements show focus indicators
- Unit test: Keyboard navigation works without mouse

**Responsive Design Tests**:
- Property test: Layout adapts for 768-1024px viewports
- Unit test: Mobile navigation appears below 768px
- Unit test: Touch targets meet minimum size on mobile

**Cod Unit test: Toast with action button doesn't auto-dismiss
- Unit test: Maximum 5 toasts displayed simultaneously
- Property test: Toast messages don't contain stack traces

**Keyboard Shortcut Tests**:
- Unit test: Ctrl+Enter triggers explanation
- Unit test: Escape closes modals
- Unit test: Ctrl+? opens shortcuts help
- Property test: All shortcuts call preventDefault()

**Loading State Tests**:
- Property test: Any loading state shows indicator
- Property test: Loading animations complete within 300ms
- Unit