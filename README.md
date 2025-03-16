# OFC Multi-Account Automation

A modular and maintainable automation tool for 0n3football Challenges (OFC) that handles multiple accounts and automatically completes available tasks.

## Features

- **Multi-Account Support**: Manage multiple wallets simultaneously
- **Proxy Integration**: Support for HTTP/HTTPS proxies
- **Flexible Configuration**: Environment variables or file-based configuration
- **Task Scheduling**: Configurable intervals between task runs
- **Comprehensive Logging**: Detailed logs with rotating files
- **Error Handling**: Robust retry mechanism with configurable options
- **Security**: Improved handling of sensitive information

## Installation

1. **Clone the repository**

```bash
git clone https://github.com/Usernameusernamenotavailbleisnot/0n3football.git
cd 0n3football
```

2. **Install dependencies**

```bash
npm install
```
This will install all dependencies defined in the package.json file.

3. **Create configuration files**

Create the following files in the project root:

- `pk.txt` - One private key per line
- `proxy.txt` - Proxy configurations in format: `host:port:username:password`

## Configuration

### File-Based Configuration

- **Private Keys**: Create a `pk.txt` file with one private key per line
- **Proxy Configuration**: Create a `proxy.txt` file with one proxy per line in format: `host:port:username:password`

## Usage

### Command Line Options

```bash
# Run with default settings
npm start

# Run once and exit
npm start -- --run-once

# Run with custom interval (hours)
npm start -- --interval 12

# Show help
npm start -- --help
```

### Running as a Service

For persistent operation, you can use PM2:

```bash
# Install PM2
npm install -g pm2

# Start as a service
pm2 start src/index.js --name ofc-automation

# View logs
pm2 logs ofc-automation

# Monitor
pm2 monit
```

## Project Structure

```
src/
├── config/             # Configuration management
├── services/           # Core services
├── models/             # Data models
├── utils/              # Utility functions
├── data/               # Static data files
├── index.js            # Application entry point
├── scheduler.js        # Task scheduling
└── task-processor.js   # Task processing logic
```

Files to create:
```
pk.txt        # Private keys, one per line
proxy.txt     # Proxy configs, format: host:port:username:password
```

Example format for these files is provided in:
```
pk.txt.example
proxy.txt.example
```

## Supported Task Types

- General check-ins and daily tasks
- Twitter follows
- Twitter retweets
- External link visits
- Quiz completions

## Advanced Configuration

### Quiz Answers

Quiz answers can be configured in `src/data/quiz-answers.json` or will be loaded from the default hardcoded values.

### Proxy Rotation

If you provide more proxies than wallets, each wallet will use a dedicated proxy. If you provide fewer, proxies will be rotated among wallets.

## Security Considerations

- Private keys are sensitive data. Ensure pk.txt has appropriate file permissions
- Logs are sanitized to avoid exposing sensitive information
- Authentication tokens are handled securely

## Troubleshooting

Check the logs in the `logs/` directory for detailed information:

- `combined-YYYY-MM-DD.log` - All logs
- `error-YYYY-MM-DD.log` - Error logs only

## License

This project is licensed under the MIT License - see the LICENSE file for details.
