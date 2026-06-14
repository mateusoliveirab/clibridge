# Adding a CLI Adapter

To add a new CLI provider, you don't need to recompile or write custom TypeScript code. You can simply add it to the data-driven configuration file.

1. Open `src/adapters/adapters-config.json`
2. Add a new JSON block with your CLI's unique key.
3. Configure the `command`, `capabilities`, `args` (using the declarative argument tokens), and `output` parser.

Example for `aider`:
```json
{
  "aider": {
    "command": "aider",
    "capabilities": {
      "structuredOutput": false,
      "images": false,
      "sandbox": false,
      "skipPermissions": false
    },
    "args": [
      { "lit": "--message" },
      { "var": "prompt" }
    ],
    "output": {
      "type": "raw",
      "trim": true
    }
  }
}
```

This will automatically expose the `aider` adapter to the internal registry!
