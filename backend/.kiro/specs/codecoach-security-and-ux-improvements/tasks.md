# Implementation Plan: CodeCoach Security and UX Improvements

## Overview

This implementation plan addresses critical security vulnerabilities and user experience enhancements for CodeCoach Studio. The work is organized into two main tracks: Priority 1 (Security Hardening) and Priority 2 (UX Enhancements). Each task builds incrementally, with testing integrated throughout to catch errors early.

## Tasks

- [ ] 1. Protect sensitive files from version control
  - [ ] 1.1 Update .gitignore files to exclude sensitive paths
    - Add backend/.env, codecoach/.env, and backend/data/ to .gitignore
    - Create backend/.gitignore if it doesn't exist
    - Verify entries are properly formatted
    - _Requirements: 1.1, 1.2, 1.3_
  
  - [ ]* 1.2 Write unit tests for gitignore configuration
    - Test that .gitignore files contain required entries
    - Test that sensitive files are excluded from git status
    - _Requirements: 1.1, 1.2, 1.3_
  
  - [ ] 1.3 Create documentation for API key rotation and git history cleanup
    - Document process for rotating exposed API keys (Groq, AWS)
    - Document git filter-branch or BFG Repo-Cleaner usage
    - Add security warnings to README
    - _Requirements: 1.4, 1.5_

- [ ] 2. Implement environment configuration validation
  - [ ] 2.1 Create environment validator module
    - Create backend/validateEnv.js with validation functions
    - Validate AUTH_SECRET length (minimum 32 characters)
    - Validate AUTH_SECRET is not default value
    - Validate required AI provider credentials based on AI_PROVIDER
    - Return descriptive error messages for each validation failure
    - _Requirements: 2.1, 2.2, 2.3_
  
  - [ ]* 2.2 Write property test for AUTH_SECRET length validation
    - **Property 2: AUTH_SECRET Length Validation**
    - **Validates: Requirements 2.1, 2.3**
  
  - [ ]* 2.3 Write unit tests for environment validation
    - Test default AUTH_SECRET value is rejected
    - Test missing AI provider credentials fail
    - Test valid configuration passes
    - _Requirements: 2.1, 2.2, 2.3_
  
  - [ ] 2.4 Update .env.example files with security warnings
    - Add security warnings to backend/.env.example
    - Document AUTH_SECRET generation process (e.g., openssl rand -hex 32)
    - Add warnings to codecoach/.env.example
    - _Requirements: 2.4, 2.5_
  
  - [ ] 2.5 Integrate validator into backend startup
    - Import validateEnv in backend/index.js
    - Call validation before server starts listening
    - Exit with non-zero status code on validation failure
    - _Requirements: 2.1, 2.2, 2.3_

- [ ] 3. Checkpoint - Verify security configuration
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement database backup system
  - [ ] 4.1 Create backup manager module
    - Create backend/backupManager.js
    - Implement createBackup(dbPath) function with ISO timestamp filenames
    - Implement rotateBackups(backupDir, maxBackups) function
    - Implement restoreBackup(backupPath, dbPath) function
    - Ensure backups directory is created if missing
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  
  - [ ]* 4.2 Write property test for backup before write
    - **Property 3: Database Backup Before Write**
    - **Validates: Requirements 3.1**
  
  - [ ]* 4.3 Write property test for backup filename format
    - **Property 4: Backup Filename Format**
    - **Validates: Requirements 3.2**
  
  - [ ]* 4.4 Write property test for backup rotation limit
    - **Property 5: Backup Rotation Limit**
    - **Validates: Requirements 3.3**
  
  - [ ]* 4.5 Write property test for backup restore round trip
    - **Property 6: Backup Restore Round Trip**
    - **Validates: Requirements 3.4**
  
  - [ ]* 4.6 Write property test for backup failure resilience
    - **Property 7: Backup Failure Resilience**
    - **Validates: Requirements 3.6**
  
  - [ ] 4.7 Integrate backup system into database writes
    - Modify writeDb() function in backend/index.js
    - Call createBackup() before writing
    - Call rotateBackups() after successful backup
    - Log errors but continue on backup failure
    - _Requirements: 3.1, 3.2, 3.3, 3.6_
  
  - [ ] 4.8 Create backup/restore documentation
    - Document backup location and filename format
    - Document manual restore process
    - Add troubleshooting section
    - _Requirements: 3.5_

- [ ] 5. Enhance code execution safety warnings
  - [ ] 5.1 Add code execution warning banner to frontend
    - Add warning banner above code editor terminal in App.tsx
    - Include warning icon and descriptive text
    - Style with prominent colors (yellow/orange)
    - Display timeout duration (5 seconds)
    - _Requirements: 4.1, 4.5_
  
  - [ ] 5.2 Add confirmation dialog before code execution
    - Modify runCodePreview() to show confirmation dialog
    - Include security warning in dialog text
    - Only proceed if user confirms
    - _Requirements: 4.2_
  
  - [ ]* 5.3 Write property test for code execution confirmation
    - **Property 8: Code Execution Confirmation Required**
    - **Validates: Requirements 4.2**
  
  - [ ]* 5.4 Write property test for code execution timeout
    - **Property 9: Code Execution Timeout Enforcement**
    - **Validates: Requirements 4.3**
  
  - [ ] 5.5 Update code execution timeout to 5 seconds
    - Change timeout from 2 seconds to 5 seconds in runCodePreview()
    - Update timeout error message
    - _Requirements: 4.3_
  
  - [ ] 5.6 Create code execution security documentation
    - Document Web Worker sandboxing limitations
    - Document timeout behavior
    - Add warnings about untrusted code
    - _Requirements: 4.4_

- [ ] 6. Checkpoint - Verify security improvements
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement toast notification system
  - [ ] 7.1 Create Toast component and hook
    - Create codecoach/src/components/Toast.tsx
    - Create codecoach/src/hooks/useToast.ts
    - Implement toast types (success, error, info, warning)
    - Implement auto-dismiss logic (5 seconds for toasts without actions)
    - Implement manual dismiss functionality
    - Add toast animations (slide in/out)
    - _Requirements: 6.1, 6.5_
  
  - [ ]* 7.2 Write property test for error toast display
    - **Property 12: Error Toast Display**
    - **Validates: Requirements 6.1, 6.3**
  
  - [ ]* 7.3 Write property test for toast auto-dismiss behavior
    - **Property 15: Toast Auto-Dismiss Behavior**
    - **Validates: Requirements 6.5**
  
  - [ ] 7.4 Integrate toast system into App.tsx
    - Add useToast hook to App component
    - Replace setErrorMessage() calls with showToast()
    - Add ToastContainer to render tree
    - Ensure error messages don't contain stack traces
    - _Requirements: 6.1, 6.3_
  
  - [ ] 7.5 Add retry buttons to network error toasts
    - Detect network request failures
    - Add retry action to error toasts
    - Implement retry logic for failed requests
    - _Requirements: 6.2_
  
  - [ ]* 7.6 Write property test for failed request retry option
    - **Property 13: Failed Request Retry Option**
    - **Validates: Requirements 6.2**
  
  - [ ] 7.7 Add recovery suggestions for known errors
    - Identify common error types (offline, auth, timeout)
    - Add specific recovery steps to error messages
    - _Requirements: 6.4_
  
  - [ ]* 7.8 Write property test for error recovery suggestions
    - **Property 14: Error Recovery Suggestions**
    - **Validates: Requirements 6.4**

- [ ] 8. Implement skeleton loader system
  - [ ] 8.1 Create Skeleton component
    - Create codecoach/src/components/SkeletonLoader.tsx
    - Implement variants (text, rect, circle)
    - Add shimmer animation with CSS
    - Support multiple lines with count prop
    - _Requirements: 5.1_
  
  - [ ] 8.2 Replace loading text with skeleton loaders
    - Replace "Loading..." in results panel with skeleton blocks
    - Replace "Explaining..." button text with spinner
    - Add skeleton cards for analytics loading
    - _Requirements: 5.1, 5.3, 5.4_
  
  - [ ]* 8.3 Write property test for loading state indicators
    - **Property 10: Loading State Indicators**
    - **Validates: Requirements 5.1, 5.3, 5.4**
  
  - [ ]* 8.4 Write property test for loading animation performance
    - **Property 11: Loading Animation Performance**
    - **Validates: Requirements 5.5**

- [ ] 9. Implement onboarding system
  - [ ] 9.1 Create Onboarding component
    - Create codecoach/src/components/Onboarding.tsx
    - Implement overlay with spotlight effect
    - Implement step navigation (next, previous, skip)
    - Store completion state in localStorage
    - _Requirements: 7.1, 7.5_
  
  - [ ] 9.2 Define onboarding steps
    - Create onboarding steps array with targets and content
    - Step 1: Welcome and overview
    - Step 2: Code editor introduction
    - Step 3: Explain button
    - Step 4: Results panel
    - Step 5: Quiz Studio
    - Step 6: Keyboard shortcuts hint
    - _Requirements: 7.1_
  
  - [ ] 9.3 Add tooltips to key features
    - Add tooltip component or use existing library
    - Add tooltips to Explain button, Quiz Studio, AI Mentor
    - Show on hover with explanations
    - _Requirements: 7.2, 7.3_
  
  - [ ]* 9.4 Write property test for tooltip display on hover
    - **Property 16: Tooltip Display on Hover**
    - **Validates: Requirements 7.3**
  
  - [ ] 9.5 Integrate onboarding into App.tsx
    - Check localStorage for onboarding completion
    - Show onboarding on first visit
    - Allow skip/dismiss
    - _Requirements: 7.1, 7.5_

- [ ] 10. Checkpoint - Verify UX improvements
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Add visual polish and micro-interactions
  - [ ] 11.1 Implement hover effects for interactive elements
    - Add hover styles to buttons (scale, shadow, color)
    - Add hover styles to links
    - Add hover styles to input fields
    - _Requirements: 8.1_
  
  - [ ] 11.2 Implement button ripple animations
    - Add ripple effect on button click
    - Use CSS or JavaScript for ripple animation
    - _Requirements: 8.2_
  
  - [ ] 11.3 Implement modal animations
    - Add fade-in animation for modal backdrop
    - Add slide-in or scale animation for modal content
    - Add smooth close animations
    - _Requirements: 8.3_
  
  - [ ]* 11.4 Write property test for interactive element hover effects
    - **Property 17: Interactive Element Hover Effects**
    - **Validates: Requirements 8.1, 8.2, 8.3**
  
  - [ ] 11.5 Verify and improve color contrast
    - Audit all text/background color combinations
    - Ensure WCAG AA compliance (4.5:1 for normal, 3:1 for large)
    - Adjust colors as needed
    - _Requirements: 8.4_
  
  - [ ]* 11.6 Write property test for color contrast accessibility
    - **Property 18: Color Contrast Accessibility**
    - **Validates: Requirements 8.4**
  
  - [ ] 11.7 Add visible focus indicators
    - Add focus styles to all focusable elements
    - Use outline or border for keyboard focus
    - Ensure focus indicators are prominent
    - _Requirements: 8.5_
  
  - [ ]* 11.8 Write property test for keyboard focus visibility
    - **Property 19: Keyboard Focus Visibility**
    - **Validates: Requirements 8.5**

- [ ] 12. Implement performance metrics display
  - [ ] 12.1 Add response time tracking
    - Track request start time for AI operations
    - Calculate and store response time
    - Display response time in results header
    - _Requirements: 9.1_
  
  - [ ] 12.2 Enhance confidence score display
    - Make confidence score more prominent in results
    - Add color coding (green=high, yellow=medium, red=low)
    - _Requirements: 9.2_
  
  - [ ] 12.3 Add Fast/Detailed mode toggle
    - Add toggle UI element (UI only, no backend changes)
    - Store preference in localStorage
    - Display current mode
    - _Requirements: 9.3_
  
  - [ ] 12.4 Enhance backend health indicator
    - Add color coding (green=online, red=offline, gray=checking)
    - Add icon for visual clarity
    - Display last check time
    - _Requirements: 9.4_
  
  - [ ] 12.5 Add real-time performance metric updates
    - Update metrics during AI operations
    - Show progress or elapsed time
    - _Requirements: 9.5_
  
  - [ ]* 12.6 Write property test for performance metrics display
    - **Property 20: Performance Metrics Display**
    - **Validates: Requirements 9.1, 9.2, 9.5**

- [ ] 13. Implement keyboard shortcuts
  - [ ] 13.1 Add keyboard shortcut handler
    - Create useEffect hook for keydown events in App.tsx
    - Handle Ctrl+Enter / Cmd+Enter for code explanation
    - Handle Escape for closing modals
    - Handle Ctrl+? / Cmd+? for shortcuts help
    - Call preventDefault() for all custom shortcuts
    - _Requirements: 10.1, 10.2, 10.3, 10.5_
  
  - [ ]* 13.2 Write property test for modal escape key closure
    - **Property 21: Modal Escape Key Closure**
    - **Validates: Requirements 10.2**
  
  - [ ]* 13.3 Write property test for keyboard shortcut non-interference
    - **Property 22: Keyboard Shortcut Non-Interference**
    - **Validates: Requirements 10.5**
  
  - [ ] 13.4 Create keyboard shortcuts help modal
    - Create modal component listing all shortcuts
    - Organize by category (navigation, editing, help)
    - Show keyboard icons for visual clarity
    - _Requirements: 10.3_
  
  - [ ] 13.5 Add keyboard shortcut hints to UI
    - Add hint text near Explain button (Ctrl+Enter)
    - Add hint in modal headers (Esc to close)
    - Add hint for shortcuts help (Ctrl+?)
    - _Requirements: 10.4_

- [ ] 14. Optimize mobile responsiveness
  - [ ] 14.1 Add responsive breakpoints to CSS
    - Add tablet breakpoint (768px - 1024px)
    - Add mobile breakpoint (< 768px)
    - Switch to vertical layout on tablets
    - Implement collapsible sections on mobile
    - _Requirements: 11.1, 11.2_
  
  - [ ]* 14.2 Write property test for responsive layout optimization
    - **Property 23: Responsive Layout Optimization**
    - **Validates: Requirements 11.2**
  
  - [ ] 14.3 Ensure touch target minimum sizes
    - Audit all interactive elements
    - Ensure minimum 44x44px touch targets
    - Increase button padding on mobile
    - _Requirements: 11.3_
  
  - [ ]* 14.4 Write property test for touch target minimum size
    - **Property 24: Touch Target Minimum Size**
    - **Validates: Requirements 11.3**
  
  - [ ] 14.5 Implement mobile navigation
    - Add hamburger menu or bottom navigation for mobile
    - Ensure all features accessible on mobile
    - Test navigation on tablet viewports
    - _Requirements: 11.4_
  
  - [ ]* 14.6 Write property test for mobile navigation accessibility
    - **Property 25: Mobile Navigation Accessibility**
    - **Validates: Requirements 11.4**

- [ ] 15. Final checkpoint - Integration and testing
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Documentation and cleanup
  - [ ] 16.1 Update README with new features
    - Document security improvements
    - Document new UX features
    - Add screenshots of key features
    - _Requirements: All_
  
  - [ ] 16.2 Create SECURITY.md
    - Document security best practices
    - Document API key rotation process
    - Document backup/restore process
    - _Requirements: 1.4, 1.5, 2.4, 2.5, 3.5, 4.4_
  
  - [ ] 16.3 Verify all documentation is complete
    - Check .env.example files
    - Check inline code comments
    - Check README and SECURITY.md
    - _Requirements: 1.4, 1.5, 2.4, 2.5, 3.5, 4.4_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Security improvements (tasks 1-6) should be completed before UX enhancements (tasks 7-14)
- All changes maintain backward compatibility with existing functionality
