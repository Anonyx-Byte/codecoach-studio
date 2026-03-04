# Implementation Plan: Production Scalability Migration

## Overview

This plan migrates CodeCoach Studio from a file-based JSON database to a production-ready architecture using PostgreSQL and Redis. The implementation follows a phased approach to minimize risk, with each phase building on the previous one. All existing API contracts remain unchanged to ensure backward compatibility.

## Tasks

- [ ] 1. Setup infrastructure dependencies and configuration
  - Install required npm packages (pg, ioredis, bcrypt, node-pg-migrate)
  - Create .env.example with new required variables (DATABASE_URL, REDIS_URL, DB_POOL_SIZE, BCRYPT_ROUNDS, CACHE_TTL)
  - Create config/validator.js for environment validation
  - Update package.json with migration scripts
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [ ] 2. Implement database layer
  - [ ] 2.1 Create database connection module with connection pooling
    - Implement db/connection.js with Pool configuration
    - Add query method with logging
    - Add transaction method with rollback support
    - Add healthCheck method with pool metrics
    - Add graceful close method
    - _Requirements: 1.1, 1.3, 1.6, 7.1, 7.3_
  
  - [ ]* 2.2 Write property test for database connection
    - **Property 10: Connection Pool Bounds**
    - **Validates: Requirements 1.3, 11.4**
  
  - [ ] 2.3 Create PostgreSQL schema migration
    - Create migrations directory
    - Write initial migration for users table with UUID, indexes, and JSONB columns
    - Add trigger for automatic updated_at timestamp
    - Test migration up and down
    - _Requirements: 1.1, 1.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
  
  - [ ] 2.4 Implement user repository
    - Create db/repositories/userRepository.js
    - Implement findByEmail with caching
    - Implement findById with caching
    - Implement create with transaction and cache invalidation
    - Implement update with transaction and cache invalidation
    - Use parameterized queries for SQL injection prevention
    - _Requirements: 1.1, 1.2, 1.7, 2.3, 2.4, 12.1_
  
  - [ ]* 2.5 Write property test for user repository
    - **Property 1: Concurrent Write Safety**
    - **Validates: Requirements 1.2**
  
  - [ ]* 2.6 Write property test for transaction atomicity
    - **Property 4: Transaction Atomicity**
    - **Validates: Requirements 1.2, 5.3**

- [ ] 3. Implement Redis cache layer
  - [ ] 3.1 Create Redis connection module
    - Implement cache/connection.js with retry strategy
    - Add get method with JSON parsing and error handling
    - Add set method with TTL support
    - Add del method for cache invalidation
    - Add healthCheck method
    - Add graceful close method
    - _Requirements: 2.2, 2.6, 7.2, 7.4_
  
  - [ ] 3.2 Implement distributed rate limiter
    - Create middleware/rateLimiter.js using Redis INCR and EXPIRE
    - Implement fail-open behavior when Redis is unavailable
    - Add logging for rate limit violations
    - _Requirements: 2.1, 2.7, 10.3_
  
  - [ ]* 3.3 Write property test for rate limiter
    - **Property 2: Rate Limit Consistency**
    - **Validates: Requirements 2.1, 6.5**
  
  - [ ]* 3.4 Write property test for cache invalidation
    - **Property 3: Cache Invalidation Correctness**
    - **Validates: Requirements 2.4**
  
  - [ ]* 3.5 Write property test for graceful degradation
    - **Property 5: Graceful Degradation**
    - **Validates: Requirements 2.6**

- [ ] 4. Checkpoint - Verify database and cache layers
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement async authentication
  - [ ] 5.1 Create bcrypt authentication module
    - Create auth/bcryptAuth.js
    - Implement async hashPassword using bcrypt
    - Implement async verifyPassword using bcrypt.compare
    - Use configurable salt rounds (default 10)
    - _Requirements: 3.1, 3.2, 3.3_
  
  - [ ]* 5.2 Write property test for non-blocking auth
    - **Property 6: Password Hashing Non-Blocking**
    - **Validates: Requirements 3.2**
  
  - [ ] 5.3 Update authentication endpoints to use bcrypt
    - Replace hashPassword calls in /api/auth/register
    - Replace password verification in /api/auth/login
    - Ensure all operations are async/await
    - Maintain timing-safe comparison for security
    - _Requirements: 3.1, 3.2, 3.4, 12.3_
  
  - [ ]* 5.4 Write unit tests for authentication endpoints
    - Test registration with bcrypt
    - Test login with bcrypt
    - Test timing under load (< 200ms)
    - _Requirements: 3.4_

- [ ] 6. Integrate database and cache into main application
  - [ ] 6.1 Update index.js to initialize database and cache connections
    - Add ConfigValidator.validate() at startup
    - Initialize DatabaseConnection with validated config
    - Initialize CacheConnection with validated config
    - Test database connectivity on startup (fail fast)
    - Test Redis connectivity on startup (fail fast)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  
  - [ ]* 6.2 Write property test for environment validation
    - **Property 7: Environment Validation Fail-Fast**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
  
  - [ ] 6.3 Replace in-memory rate limiters with distributed rate limiters
    - Update authLimiter to use DistributedRateLimiter
    - Update aiLimiter to use DistributedRateLimiter
    - Update runLimiter to use DistributedRateLimiter
    - Update voiceLimiter to use DistributedRateLimiter
    - _Requirements: 2.1, 2.7_
  
  - [ ] 6.4 Update all database operations to use UserRepository
    - Replace readDb/writeDb/updateDb calls in /api/auth/register
    - Replace readDb/writeDb/updateDb calls in /api/auth/login
    - Replace readDb/writeDb/updateDb calls in /api/auth/google
    - Replace readDb calls in /api/auth/me
    - Replace updateDb calls in /api/profile
    - Replace updateDb calls in /api/profile/sync
    - Replace readDb/updateDb calls in /api/analytics/attempt
    - Replace updateDb calls in /api/proctor/event
    - Replace readDb calls in /api/analytics/dashboard
    - _Requirements: 1.1, 1.2, 1.6, 1.7_
  
  - [ ]* 6.5 Write integration tests for updated endpoints
    - Test user registration end-to-end
    - Test user login end-to-end
    - Test Google OAuth end-to-end
    - Test profile updates end-to-end
    - Test analytics recording end-to-end
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ] 7. Implement enhanced health check endpoint
  - [ ] 7.1 Update /api/health endpoint
    - Add database health check with pool metrics
    - Add Redis health check
    - Return 503 if any dependency is unhealthy
    - Return 200 with detailed metrics if all healthy
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
  
  - [ ]* 7.2 Write unit tests for health check
    - Test healthy state
    - Test database failure state
    - Test Redis failure state
    - Test pool metrics reporting
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [ ] 8. Checkpoint - Verify application integration
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Implement data migration script
  - [ ] 9.1 Create migration script
    - Create scripts/migrate-data.js
    - Implement backup function with timestamp
    - Implement loadJsonData function
    - Implement migrate function with transaction
    - Add validation for each user record
    - Add error handling and rollback
    - Add progress logging
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  
  - [ ]* 9.2 Write property test for migration data integrity
    - **Property 8: Migration Data Integrity**
    - **Validates: Requirements 5.2, 5.4**
  
  - [ ] 9.3 Create migration CLI wrapper
    - Add npm script "migrate:data" to package.json
    - Add command-line arguments for JSON path and database URL
    - Add dry-run mode for testing
    - _Requirements: 5.1, 5.7_
  
  - [ ]* 9.4 Write unit tests for migration script
    - Test backup creation
    - Test JSON loading
    - Test data transformation
    - Test rollback on error
    - _Requirements: 5.3, 5.5, 5.6_

- [ ] 10. Implement graceful shutdown
  - [ ] 10.1 Add shutdown handlers to index.js
    - Listen for SIGTERM and SIGINT signals
    - Stop accepting new requests
    - Wait for in-flight requests to complete (10-second timeout)
    - Close database connections gracefully
    - Close Redis connections gracefully
    - Exit process
    - _Requirements: 6.2, 6.3_
  
  - [ ]* 10.2 Write integration tests for graceful shutdown
    - Test shutdown with active requests
    - Test connection cleanup
    - Test timeout behavior
    - _Requirements: 6.2, 6.3_

- [ ] 11. Setup PM2 cluster configuration
  - [ ] 11.1 Create PM2 ecosystem file
    - Create ecosystem.config.js
    - Configure cluster mode with instance count
    - Configure graceful shutdown settings
    - Configure auto-restart on failure
    - Configure log rotation
    - Configure environment variables
    - _Requirements: 6.1, 6.4_
  
  - [ ] 11.2 Add PM2 scripts to package.json
    - Add "pm2:start" script
    - Add "pm2:stop" script
    - Add "pm2:restart" script
    - Add "pm2:logs" script
    - Add "pm2:monit" script
    - _Requirements: 6.1, 6.4_
  
  - [ ]* 11.3 Write integration tests for cluster mode
    - Test multiple instances startup
    - Test rate limiting across instances
    - Test load distribution
    - _Requirements: 6.1, 6.5_

- [ ] 12. Implement comprehensive error logging
  - [ ] 12.1 Add structured logging for database errors
    - Log query context on errors
    - Log user ID when available
    - Log timestamp and error stack
    - Never log sensitive data (passwords, tokens)
    - _Requirements: 10.1, 12.2_
  
  - [ ] 12.2 Add structured logging for Redis errors
    - Log operation context on errors
    - Log timestamp and error message
    - _Requirements: 10.2, 12.2_
  
  - [ ] 12.3 Add logging for rate limit violations
    - Log client IP and endpoint
    - Log timestamp and rate limit window
    - _Requirements: 10.3_
  
  - [ ] 12.4 Add logging for authentication failures
    - Log client IP and attempted email
    - Log timestamp and failure reason
    - Never log passwords
    - _Requirements: 10.4, 12.2_
  
  - [ ] 12.5 Add startup configuration logging
    - Log database connection status
    - Log Redis connection status
    - Log pool size and cache TTL
    - Never log AUTH_SECRET or connection strings
    - _Requirements: 10.5, 12.2_
  
  - [ ] 12.6 Add connection pool exhaustion logging
    - Log warning when pool is exhausted
    - Log current pool metrics
    - _Requirements: 10.6_

- [ ] 13. Checkpoint - Verify production readiness
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Create deployment documentation
  - [ ] 14.1 Update README with migration instructions
    - Document new environment variables
    - Document migration script usage
    - Document PM2 cluster setup
    - Document health check endpoint
    - _Requirements: 4.1, 4.2, 4.3, 5.1, 6.1, 7.1_
  
  - [ ] 14.2 Create deployment checklist
    - Provision PostgreSQL database
    - Provision Redis instance
    - Set environment variables
    - Run database migrations
    - Run data migration script
    - Test health check endpoint
    - Start PM2 cluster
    - Verify rate limiting works
    - Monitor logs for errors
    - _Requirements: 1.1, 2.1, 4.1, 4.2, 4.3, 5.1, 6.1, 7.1_

- [ ]* 15. Load testing and performance validation
  - [ ]* 15.1 Write load tests for concurrent users
    - Test 100+ concurrent users
    - Measure response times (p50, p95, p99)
    - Verify no data loss
    - _Requirements: 11.1, 11.2_
  
  - [ ]* 15.2 Write load tests for authentication
    - Test concurrent login/register operations
    - Verify < 200ms response time at p95
    - _Requirements: 11.2_
  
  - [ ]* 15.3 Write load tests for cached queries
    - Test concurrent API requests
    - Verify < 500ms response time at p95 for cached queries
    - Measure cache hit rate (should be > 60%)
    - _Requirements: 11.3, 11.5_
  
  - [ ]* 15.4 Write load tests for connection pool
    - Test requests exceeding pool size
    - Verify queuing behavior
    - Verify no connection exhaustion errors
    - _Requirements: 11.4_

- [ ]* 16. Property test for API backward compatibility
  - **Property 9: API Backward Compatibility**
  - Generate API requests with existing format
  - Verify response format matches expectations
  - **Validates: Requirements 8.1, 8.2**

- [ ] 17. Final checkpoint - Production deployment
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties with minimum 100 iterations
- Unit tests validate specific examples and edge cases
- Integration tests validate end-to-end flows
- Load tests validate performance requirements
- All existing API contracts remain unchanged (backward compatibility)
- Migration script includes rollback capability for safety
- Graceful shutdown ensures no data loss during deployments
- PM2 cluster mode enables horizontal scaling
