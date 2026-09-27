const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const channels = [
  {
    channelId: "chan-emergency-01",
    name: "EMERGENCY_BROADCAST",
    description: "High-priority emergency distress and override channel",
    frequencyMhz: 433.175,
    isEncrypted: false,
  },
  {
    channelId: "chan-cmd-net-02",
    name: "COMMAND_NET",
    description: "Squad lead and command telemetry channel",
    frequencyMhz: 434.25,
    isEncrypted: true,
  },
  {
    channelId: "chan-sector4-03",
    name: "SECTOR_4_TAC",
    description: "Local ground patrol and sector 4 coordination",
    frequencyMhz: 868.1,
    isEncrypted: true,
  },
];

async function main() {
  for (const channel of channels) {
    await prisma.tacticalChannel.upsert({
      where: { channelId: channel.channelId },
      update: channel,
      create: channel,
    });
  }
}

main()
  .catch((error) => {
    console.error("Tactical channel seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });