# Contributing to Delulu

First off, thank you for considering contributing to Delulu! It's people like you that make the open-source community such an amazing place to learn, inspire, and create.

## Code of Conduct

By participating in this project, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

## How Can I Contribute?

### Reporting Bugs
- Use the GitHub Issue Tracker.
- Describe the bug and include steps to reproduce it.
- Include your OS and browser version (if relevant).

### Suggesting Enhancements
- Open an issue and describe the enhancement you'd like to see.
- Explain why this enhancement would be useful.

### Adding New Providers (High Priority!)
We are always looking to expand our extraction capabilities. If you want to add a new streaming provider:
1. Review the existing logic in `local-extractor/extractor.js`.
2. Implement your provider logic using Puppeteer in a new module or as a case in the extraction handler.
3. Ensure you follow the standard JSON I/O format for the `stdio-bridge.js`.
4. Submit a Pull Request! **New provider contributions are highly appreciated and celebrated.**

### Pull Requests
1. Fork the repository.
2. Create a new branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes (`git commit -m 'Add some amazing feature'`).
4. Push to the branch (`git push origin feature/amazing-feature`).
5. Open a Pull Request.

## Development Setup

See [docs/development.md](docs/development.md) for detailed setup instructions.
