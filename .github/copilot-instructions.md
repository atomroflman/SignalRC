# Project Overview
This project is a C# LTE powered RC Car platform with a modular architecture, allowing easy integration of various hardware components and features.

## Architecture
The project is structured into several key components, that are organized in folders:
```
LteCar/
├── Onboard/                # Main application running on the car
│   ├── Control/            # Control channel implementations (Steering, Throttle, etc.)
│   ├── Hardware/           # Hardware abstraction layer and drivers
│   ├── Telemetry/          # Telemetry channel implementations (GPS, IMU, etc.)
│   ├── Video/              # Video streaming and camera handling
│   ├── appSettings.json    # Application settings and configuration
│   └── channelMap.json     # Hardware and channel mapping configuration
├── VehicleTemplates/       # Predefined vehicle templates
│   ├── [TemplateName]/     # Example vehicle template with documentation
│   │   ├── docs/           # Documentation for the Vehicle
│   │   ├── models/         # 3D models and CAD files
│   │   ├── scripts/        # Custom Scripts for additional features
│   │   └── config.json     # Vehicle configuration file
│   └── README.md           # Overview of available vehicle templates
├── Shared/                 # Shared utilities and extensions
├── Server/                 # Server-side components and APIs
│   ├── Hubs/               # SignalR hubs for real-time communication
│   ├── Services/           # Business logic and services
│   ├── Data/               # Database context and migrations
│   ├── appsettings.json    # Server application settings
│   └── Program.cs          # Server entry point
├── docs/                   # General documentation
│   ├── Server/             # Server documentation
│   ├── Onboard/            # Onboard documentation
│   └── VehicleTemplates/   # VehicleTemplates documentation
└── README.md               # Project overview and documentation
```

The Server component handles user authentication, vehicle management, and real-time communication using SignalR. 
The Onboard application runs on the RC car, managing hardware interactions, control channels, telemetry, and video streaming. 
The Client is running in the Browser but served from the same machine than the API / Server.

## General considerations
The communication will be channeled over the server.
The transport shall be done with SignalR.
The transport between Car and Server shall be done with MessagePack.
The transport between Car and Server shall be optimized for low bandwidth and high latency (LTE).
Keep the bandwith requirement as small as possible.
Cache and reference data to avoid multiple sends.
The transport between Client and Server shall be done with JSON.

## Copilot Instructions
Keep your findings in mind when writing code.
Store them in `.github/copilot-memories.md` for future reference.

## Language
- Write clear and concise code
- Write comments only when necessary, except for public APIs
- Write comments in English

## Code Style
- Follow SOLID principles
- Use `var` for local variable declarations when the type is obvious
- Prefer expression-bodied members for simple methods and properties
- Use pattern matching and LINQ for collections
- Use `async` and `await` for asynchronous programming
- Have no more than 3 levels of indentation
- Keep methods short and focused (max 20-30 lines)
- Favor composition over inheritance
- Favor strategy pattern over switch/case statements
- For Json property names use Attribute if name differs from C# property name
- Use extension methods for reusable logic on existing types
- Use constants or enums instead of magic strings or numbers

### Casing Conventions
- Use PascalCase for public members, methods, properties, classes, namespaces and documents
- Use camelCase for local variables
- Prefix private fields with underscore (`_fieldName`)
- Use UPPER_SNAKE_CASE for constants

### Communication
- Use `Task` for methods that do not return a value
- Use `Task<T>` for methods that return a value
- Use `IEnumerable<T>` for collections that are not modified
- Use `IList<T>` or `List<T>` for collections that are modified
- Send messages using SignalR 
- Use Typed Clients for SignalR communication

### Naming Conventions
- Use meaningful names that clearly indicate purpose
- Use nouns for classes and interfaces (prefix interfaces with 'I')
- Use verbs for methods
- Use singular names for classes and interfaces, plural for collections
- Avoid abbreviations unless widely known (e.g. Id, Url, Xml)
- Avoid using underscores in names
- Use async suffix for async methods (e.g. GetDataAsync)
- Use Try prefix for methods that return bool indicating success (e.g. TryParse)
- Use never more than 3 capital letters in a row for abbreviations (e.g. Xml, Http, Id)

## Configuration Management
- Use strongly-typed configuration service, that traverse the configuration hierarchy by using `IConfiguration`
- Traverse configuration hierarchy using classes that represent the structure of the configuration (e.g. `JanusConfiguration`, `ApplicationConfiguration`)
- Read configuration values on demand / lazy in `IConfigurationService`
- Do not store configuration values in variables
- Validate configuration on startup
- Store all options in `appsettings.json` or environment variables
- Secure sensitive data with user secrets, but keep empty placeholders in `appsettings.json`

## Dependency Injection
- Register all services in `ServiceRegistration.cs`
- Use constructor injection for dependencies
- Prefer scoped services for business logic and API services
- Generate Properties for injected dependencies
- Keep service interfaces and implementations together in the same file if there is just one implementation (Interface first, then implementation)

## Data
- Use Entity Framework Core for data access
- Use migrations for database schema changes
- Use `IEntityTypeConfiguration<T>` for entity configurations
- Do not use attributes for entity configurations

## Documentation
- Maintain a `README.md` with setup and usage instructions
- Maintain detailed documentation in the `docs` folder
- Have all settings documented from `appsettings.json` in the docs

## Logging
- Use structured logging with log levels (Information, Warning, Error, Debug)
- Log key events, errors, and important state changes
- Avoid logging sensitive information
- Use `ILogger<T>` for logging in services
- DebugLog for verbose output during development
- DebugLog every invocation including parameters
- InfoLog for high-level workflow steps
- WarnLog for recoverable issues
- ErrorLog for exceptions and critical failures

## Error Handling
- Fail fast on configuration errors
- Tell the user what went wrong and how to fix it
- Use try-catch blocks to handle exceptions
- Log exceptions with stack traces
- Throw custom exceptions for domain-specific errors
- Only catch exceptions you can handle or need to log
- Use meaningful error messages
- Implement retry logic for transient failures (e.g. network issues)
- Validate all external API responses
- Use nullability annotations (e.g. string?, int?) to indicate optional values
