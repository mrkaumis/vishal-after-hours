---
title: "Why @Transactional Sometimes Doesn't Work"
description: "A practical deep dive into Spring transactions, proxy boundaries, self invocation, rollback rules, and real production scenarios."
pubDate: "2026-09-08"
tags:
  - Java
  - Spring Boot
  - Transactions
featured: true
---

# Why @Transactional Sometimes Doesn't Work

Most developers know how to use `@Transactional`.

But knowing **where to put it, how Spring actually implements it, and why it sometimes appears to do nothing** is a completely different story.

In production systems, transaction bugs can be particularly dangerous because the application may appear to work correctly while leaving the database in an inconsistent state.

Let's understand what actually happens.

## What Does @Transactional Do?

Suppose we have a money transfer operation:

```java
@Transactional
public void transferMoney(
        Long fromAccount,
        Long toAccount,
        BigDecimal amount
) {
    debit(fromAccount, amount);
    credit(toAccount, amount);
}
```

Conceptually, we want this entire operation to behave as one unit.

Either:

```text
Debit
  ↓
Credit
  ↓
COMMIT
```

or, if something fails:

```text
Debit
  ↓
Credit ❌
  ↓
ROLLBACK
```

We don't want this:

```text
Debit      → SUCCESS
Credit     → FAILED
Database   → INCONSISTENT
```

`@Transactional` tells Spring that the method should execute within a transaction boundary.

But there is an important question:

**Who actually creates that transaction?**

The answer is not the method itself.

Spring does it through a **proxy**.

---

## How Spring Actually Handles @Transactional

When Spring creates a bean containing a transactional method, it can create a proxy around that bean.

Instead of the caller directly invoking:

```java
accountService.transferMoney();
```

the call effectively goes through something conceptually similar to:

```text
Caller
  ↓
Spring Proxy
  ↓
Start Transaction
  ↓
Real Service Method
  ↓
Commit / Rollback
```

The proxy intercepts the method invocation.

Conceptually:

```java
beginTransaction();

try {
    target.transferMoney();

    commit();
} catch (Exception e) {
    rollback();
    throw e;
}
```

This is why **the way a method is called matters**.

And this leads to one of the most common `@Transactional` problems.

---

# Problem 1: Self Invocation

Consider this:

```java
@Service
public class PaymentService {

    public void processPayment() {
        savePayment();
    }

    @Transactional
    public void savePayment() {
        // database operation
    }
}
```

A developer might expect `savePayment()` to automatically run inside a transaction.

But the call is:

```text
processPayment()
      ↓
this.savePayment()
```

The call happens inside the same object.

It does **not** go through the Spring proxy.

Therefore the transactional interceptor may never get a chance to execute.

This is called **self invocation**.

---

## Why Does Self Invocation Break It?

Imagine Spring created:

```text
Proxy
  ↓
PaymentService
```

When another bean calls:

```java
paymentService.savePayment();
```

the call becomes:

```text
Caller
  ↓
Proxy
  ↓
@Transactional
  ↓
PaymentService
```

But inside the class:

```java
this.savePayment();
```

the call becomes:

```text
PaymentService
  ↓
PaymentService
```

The proxy is completely bypassed.

---

## The Better Solution

Move the transactional operation into another service.

```java
@Service
public class PaymentService {

    private final PaymentTransactionService transactionService;

    public PaymentService(
            PaymentTransactionService transactionService
    ) {
        this.transactionService = transactionService;
    }

    public void processPayment() {
        transactionService.savePayment();
    }
}
```

And:

```java
@Service
public class PaymentTransactionService {

    @Transactional
    public void savePayment() {
        // database operation
    }
}
```

Now the call goes through the Spring proxy:

```text
PaymentService
      ↓
PaymentTransactionService Proxy
      ↓
@Transactional
      ↓
Database
```

This is much cleaner and easier to reason about.

---

# Problem 2: Private Methods

Another common mistake:

```java
@Transactional
private void savePayment() {
    // database operation
}
```

Don't use transaction boundaries on private methods expecting Spring's proxy-based transaction management to intercept them.

A better approach is to put the transaction boundary on a public service-level method:

```java
@Transactional
public void processPayment() {
    savePayment();
    updateStatus();
}
```

The transaction should generally represent a **business operation**, not an arbitrary helper method.

---

# Problem 3: Rollback Doesn't Happen for Every Exception

Consider:

```java
@Transactional
public void processOrder() {

    saveOrder();

    throw new RuntimeException("Something failed");
}
```

By default, Spring rolls back for unchecked exceptions such as:

```text
RuntimeException
Error
```

But checked exceptions behave differently.

For example:

```java
@Transactional
public void processOrder() throws Exception {

    saveOrder();

    throw new Exception("Something failed");
}
```

You might expect the transaction to roll back.

But by default, Spring does not roll back for every checked exception.

If you explicitly want rollback:

```java
@Transactional(rollbackFor = Exception.class)
public void processOrder() throws Exception {

    saveOrder();

    throw new Exception("Something failed");
}
```

Now the transaction will roll back for the checked exception as well.

---

# Problem 4: Catching the Exception Yourself

This is another subtle production issue.

Consider:

```java
@Transactional
public void processOrder() {

    try {
        saveOrder();

        throw new RuntimeException("Payment failed");

    } catch (RuntimeException e) {
        log.error("Payment failed", e);
    }
}
```

The exception occurred.

But we caught it.

From the transaction manager's perspective, the method completed normally.

So Spring may commit the transaction.

You can end up with:

```text
saveOrder()
    ↓
Exception
    ↓
Caught
    ↓
Method returns normally
    ↓
COMMIT
```

If the operation must roll back, don't blindly swallow the exception.

A common approach is:

```java
@Transactional
public void processOrder() {

    try {
        saveOrder();
        processPayment();

    } catch (RuntimeException e) {
        log.error("Order processing failed", e);
        throw e;
    }
}
```

Now the exception reaches Spring's transaction interceptor:

```text
Exception
   ↓
Propagates out
   ↓
Spring Proxy
   ↓
ROLLBACK
```

---

# Problem 5: Transaction Boundary Is Too Large

Consider:

```java
@Transactional
public void processOrder() {

    saveOrder();

    callExternalPaymentAPI();

    sendEmail();

    generateReport();

    updateOrderStatus();
}
```

This creates a transaction around everything.

That means the database transaction could remain open while:

```text
Database
   ↓
External API
   ↓
Network delay
   ↓
Email service
   ↓
Report generation
```

This can create unnecessary database connection usage and lock contention.

A better design is to keep the database transaction focused on database work.

For example:

```java
@Transactional
public void createOrder() {

    saveOrder();
    updateOrderStatus();
}
```

Then trigger external operations separately, often using an event-driven approach.

For example:

```text
Create Order
    ↓
DB Transaction
    ↓
COMMIT
    ↓
Publish Event
    ↓
Payment Service
    ↓
Notification Service
```

For reliable event publication, patterns such as the **Transactional Outbox Pattern** can be useful.

---

# Problem 6: @Transactional on the Wrong Layer

You may see code like:

```java
@Transactional
public void saveUser() {
    repository.save(user);
}
```

Technically, this can work.

But transaction boundaries are usually easier to understand when placed at the **service/business operation level**.

For example:

```java
@Transactional
public void registerUser(RegisterRequest request) {

    User user = createUser(request);

    userRepository.save(user);

    auditRepository.save(
        createAuditRecord(user)
    );
}
```

Now the transaction clearly represents one business operation:

```text
Register User
     |
     +-- Create User
     |
     +-- Save User
     |
     +-- Save Audit
     |
     +-- COMMIT
```

If anything fails:

```text
Register User
     |
     +-- Create User
     |
     +-- Save User
     |
     +-- Save Audit ❌
     |
     +-- ROLLBACK
```

This makes the business boundary much clearer.

---

# Problem 7: Database Engine Must Support Transactions

Your Java code can be perfectly correct and you can still have unexpected behavior if the underlying database configuration doesn't support transactions as expected.

For relational databases, make sure the tables/storage engine and transaction configuration support the transaction semantics you're relying on.

For example, with MySQL, transactional workloads commonly use:

```text
InnoDB
```

rather than a non-transactional storage engine.

The application layer cannot magically provide transactional guarantees that the underlying database doesn't support.

---

# Problem 8: Multiple Databases

Consider:

```java
@Transactional
public void transfer() {

    saveToDatabaseA();

    saveToDatabaseB();
}
```

A normal local Spring transaction does not automatically give you a distributed transaction across unrelated databases.

You might end up with:

```text
Database A
   ↓
COMMIT

Database B
   ↓
FAIL
```

Now your systems disagree.

For distributed systems, you typically need to think about patterns such as:

```text
Saga
Outbox
Event-driven processing
Compensation
Idempotency
```

rather than assuming one local `@Transactional` annotation will solve everything.

---

# A Real Production Example

Imagine an e-commerce order system.

We have:

```text
Order Service
Payment Service
Inventory Service
Notification Service
```

A naive implementation might look like:

```java
@Transactional
public void placeOrder(OrderRequest request) {

    orderRepository.save(order);

    paymentClient.charge(request);

    inventoryClient.reserve(request);

    emailClient.sendConfirmation(request);
}
```

At first glance this looks transactional.

But it isn't one transaction across all those systems.

The database transaction belongs to the local database.

The payment service has its own database.

The inventory service has its own database.

The email service has no reason to participate in your database transaction.

So this:

```text
@Transactional
       |
       +-- Order DB
       |
       +-- Payment Service
       |
       +-- Inventory Service
       |
       +-- Email Service
```

does **not** magically become one atomic transaction.

A more scalable architecture could be:

```text
Create Order
     ↓
Local DB Transaction
     ↓
Order Created
     ↓
Outbox Event
     ↓
Kafka
     ↓
Payment Service
     ↓
Inventory Service
     ↓
Notification Service
```

Each service owns its own transaction boundary.

Failures are handled using retries, idempotency, and compensating actions where required.

---

# How to Think About @Transactional

Don't think:

> "`@Transactional` means everything inside this method will magically roll back."

Think:

> "`@Transactional` defines a transaction boundary that Spring applies through transaction infrastructure when the method is invoked through the appropriate proxy."

That small change in understanding explains most transaction surprises.

---

# The Mental Model

Whenever you see:

```java
@Transactional
public void doSomething() {
    // business operation
}
```

ask these questions:

### 1. Is the method actually being invoked through Spring?

If the call is bypassing the proxy, transaction interception may not happen.

### 2. Is this the correct business boundary?

The transaction should usually represent a meaningful business operation.

### 3. What exception is being thrown?

Check whether Spring's rollback rules will mark the transaction for rollback.

### 4. Is the exception being swallowed?

If you catch an exception, understand what that means for rollback behavior.

### 5. Is the transaction unnecessarily long?

Avoid keeping database transactions open while waiting for slow external systems.

### 6. Are multiple systems involved?

A local transaction cannot automatically provide atomicity across microservices.

### 7. Can the operation be retried safely?

In distributed systems, retries are common.

That means **idempotency matters**.

---

# Final Takeaway

`@Transactional` is simple at the surface but powerful underneath.

The annotation itself isn't the magic.

The important concepts are:

```text
@Transactional
      ↓
Spring Proxy
      ↓
Transaction Interceptor
      ↓
Transaction Manager
      ↓
Database
```

Once you understand the proxy boundary, self invocation, rollback rules, exception propagation, transaction scope, and distributed transaction limitations, `@Transactional` becomes much less mysterious.

The real skill isn't knowing where to write:

```java
@Transactional
```

The real skill is knowing **where the transaction should begin, where it should end, and what should happen when something fails.**
