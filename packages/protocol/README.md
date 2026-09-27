# iTantra Transmission Protocol

This package defines an additive proto3 binary contract for transmission packets. It does not replace the existing JSON REST or WebSocket protocols.

`proto/transmission.proto` is the wire contract. Once published to clients, field numbers and enum numeric values must remain stable; add new fields with new numbers rather than renumbering existing fields.

The TypeScript entry point exports `encodeTransmissionPacket` and `decodeTransmissionPacket`. Encoded payloads use the `application/x-protobuf` content type. The timestamp is represented on the wire as Unix epoch milliseconds and in TypeScript as a `Date`; signatures are raw bytes.

Build and test with:

```sh
npm run build
npm test
```