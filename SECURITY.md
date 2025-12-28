# Security Policy

## Supported Versions

We release patches for security vulnerabilities in the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

We take the security of lamdis-runs seriously. If you believe you have found a security vulnerability, please report it to us through coordinated disclosure.

### Please do NOT:

- Open a public GitHub issue for security vulnerabilities
- Post about the vulnerability on social media or public forums
- Exploit the vulnerability beyond what is necessary to demonstrate it

### How to Report

**Preferred Method: GitHub Security Advisories**

1. Go to the [Security Advisories](https://github.com/lamdis-ai/lamdis-runs/security/advisories/new) page
2. Click "Report a vulnerability"
3. Fill out the form with as much detail as possible

**Alternative: Email**

If you cannot use GitHub Security Advisories, email us at: **security@lamdis.ai**

### What to Include

Please include the following information in your report:

- **Type of vulnerability** (e.g., injection, authentication bypass, information disclosure)
- **Affected component** (e.g., API endpoint, CLI, database layer)
- **Full paths of source file(s)** related to the vulnerability
- **Step-by-step instructions** to reproduce the issue
- **Proof-of-concept or exploit code** (if possible)
- **Impact assessment** - what an attacker could achieve
- **Suggested fix** (if you have one)

### What to Expect

| Timeline | Action |
|----------|--------|
| 24 hours | Initial acknowledgment of your report |
| 72 hours | Preliminary assessment and severity rating |
| 7 days   | Detailed response with remediation plan |
| 90 days  | Target for fix release (may vary based on complexity) |

### Disclosure Policy

- We will work with you to understand and validate the issue
- We will develop and test a fix
- We will prepare a security advisory
- We will coordinate the public disclosure with you
- We will credit you in the security advisory (unless you prefer to remain anonymous)

### Severity Ratings

We use the following severity ratings based on [CVSS v3.1](https://www.first.org/cvss/):

| Severity | CVSS Score | Examples |
|----------|------------|----------|
| Critical | 9.0 - 10.0 | Remote code execution, authentication bypass |
| High     | 7.0 - 8.9  | Privilege escalation, sensitive data exposure |
| Medium   | 4.0 - 6.9  | Limited data exposure, denial of service |
| Low      | 0.1 - 3.9  | Minor information disclosure |

### Safe Harbor

We consider security research conducted in accordance with this policy to be:

- Authorized concerning any applicable anti-hacking laws
- Authorized concerning any relevant anti-circumvention laws
- Exempt from restrictions in our Terms of Service that would interfere with security research

We will not pursue legal action against researchers who:

- Follow this responsible disclosure policy
- Make a good faith effort to avoid privacy violations, data destruction, and service interruption
- Do not exploit vulnerabilities beyond demonstrating the issue

## Security Best Practices for Users

When deploying lamdis-runs:

1. **Environment Variables**
   - Never commit secrets (API keys, tokens) to version control
   - Use a secrets manager in production
   - Rotate `LAMDIS_API_TOKEN` regularly

2. **Database Security**
   - Use strong passwords for MongoDB/PostgreSQL
   - Enable authentication on database connections
   - Use TLS/SSL for database connections in production
   - Restrict network access to database ports

3. **Network Security**
   - Run lamdis-runs behind a reverse proxy (nginx, Caddy) in production
   - Enable TLS/HTTPS for all external connections
   - Use `LAMDIS_HMAC_SECRET` for webhook authentication

4. **Docker Security**
   - Don't run containers as root
   - Use read-only file systems where possible
   - Keep base images updated

5. **CI/CD Security**
   - Use GitHub Secrets for sensitive values
   - Limit permissions in workflow files
   - Review third-party actions before using

## Security Features

lamdis-runs includes the following security features:

- **API Token Authentication**: All `/internal/*` endpoints require authentication
- **HMAC Signature Verification**: Optional request signing for webhooks
- **Input Validation**: Request validation using Zod schemas
- **Dependency Scanning**: Automated via Dependabot
- **Code Scanning**: Automated via CodeQL

## Acknowledgments

We thank the following security researchers for responsibly disclosing vulnerabilities:

*No vulnerabilities have been reported yet.*

---

This security policy is inspired by best practices from the open-source community and [GitHub's guide to coordinated disclosure](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/about-coordinated-disclosure-of-security-vulnerabilities).
