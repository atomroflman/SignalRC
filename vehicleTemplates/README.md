# Vehicle Templates

This directory contains vehicle configuration templates that describe hardware setup, channels, and scripts for different vehicle types.

## Directory Structure

```
vehicleTemplates/
├── <TemplateName>/
│   ├── channelMap.json      # Channel configuration (pins, PWM, etc.)
│   ├── scripts/             # Test and setup scripts
│   │   ├── init.sh
│   │   ├── test-lights.sh
│   │   └── test-servos.sh
│   └── metadata.json        # Template metadata
└── README.md
```

## metadata.json Schema

```json
{
  "name": "TemplateName",
  "version": "1.0.0",
  "author": "AuthorName",
  "description": "Description of the vehicle",
  "hardware": {
    "type": "tank|truck|car|drone|boat|custom",
    "chassis": "Chassis model/brand",
    "motors": [
      { "name": "Drive Motor", "type": "brushed", "channel": "motor-left" }
    ],
    "sensors": [],
    "extensions": []
  },
  "features": ["webSetup", "bashTool", "channelTester"]
}
```

## Features Flags

- `webSetup`: Enable web-based setup interface
- `bashTool`: Enable remote bash terminal
- `channelTester`: Enable channel testing from web UI
- `audio`: Vehicle has audio capabilities
- `video`: Vehicle has video streaming

## Creating a New Template

1. Create a new folder in `vehicleTemplates/`
2. Add `metadata.json` with your vehicle info
3. Add `channelMap.json` with channel configuration
4. Add `scripts/` folder with test scripts (optional)

## Using Templates

There is no console tool for selecting/applying templates anymore. Copy the relevant configuration from a template's files by hand; vehicle configuration and testing happen in the web client at `/car/[carId]`.
