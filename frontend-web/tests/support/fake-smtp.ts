/**
 * A minimal SMTP server on 127.0.0.1 for mail tests: EHLO, AUTH PLAIN/LOGIN, MAIL, RCPT, DATA,
 * RSET, NOOP, QUIT. No TLS (local/test config never requires it). Each test can queue reply
 * overrides for a command (e.g. a 451 on the first DATA) to simulate provider failures.
 */
import net from "node:net";

export interface ReceivedMessage {
  auth: { user: string; pass: string } | null;
  from: string;
  to: string[];
  data: string;
}

type Command = "EHLO" | "AUTH" | "MAIL" | "RCPT" | "DATA";

export interface FakeSmtp {
  port: number;
  messages: ReceivedMessage[];
  /** Number of TCP connections accepted so far. */
  connections: () => number;
  /** The next time `command` arrives, reply with `reply` instead of the normal response. */
  failNext: (command: Command, reply: string) => void;
  close: () => Promise<void>;
}

export async function startFakeSmtp(credentials: { user: string; pass: string }): Promise<FakeSmtp> {
  const messages: ReceivedMessage[] = [];
  const failures: Partial<Record<Command, string[]>> = {};
  const sockets = new Set<net.Socket>();
  let connectionCount = 0;

  const takeFailure = (command: Command) => failures[command]?.shift();

  const server = net.createServer((socket) => {
    connectionCount++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.setEncoding("utf8");

    let auth: ReceivedMessage["auth"] = null;
    let current: Omit<ReceivedMessage, "auth"> | null = null;
    let mode: "command" | "data" | "auth-user" | "auth-pass" = "command";
    let pendingUser = "";
    let buffer = "";
    let dataLines: string[] = [];

    const reply = (line: string) => socket.write(`${line}\r\n`);
    const checkAuth = (user: string, pass: string) => {
      if (user === credentials.user && pass === credentials.pass) {
        auth = { user, pass };
        reply("235 2.7.0 Authentication successful");
      } else {
        // Real servers sometimes echo what they received; this proves the client redacts it.
        reply(`535 5.7.8 Authentication failed for ${user}:${pass}`);
      }
    };

    reply("220 fake-smtp ready");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

        if (mode === "data") {
          if (line === ".") {
            mode = "command";
            const failure = takeFailure("DATA");
            if (failure) {
              reply(failure);
            } else {
              messages.push({ auth, ...current!, data: dataLines.join("\r\n") });
              reply("250 2.0.0 Queued");
            }
            current = null;
          } else {
            dataLines.push(line.startsWith("..") ? line.slice(1) : line);
          }
          continue;
        }
        if (mode === "auth-user") {
          pendingUser = Buffer.from(line, "base64").toString("utf8");
          mode = "auth-pass";
          reply(`334 ${Buffer.from("Password:").toString("base64")}`);
          continue;
        }
        if (mode === "auth-pass") {
          mode = "command";
          checkAuth(pendingUser, Buffer.from(line, "base64").toString("utf8"));
          continue;
        }

        const [verb, ...rest] = line.split(" ");
        const command = verb.toUpperCase();
        const failure = (["EHLO", "AUTH", "MAIL", "RCPT"] as const).includes(command as any) ? takeFailure(command as Command) : undefined;
        if (failure) {
          reply(failure);
          continue;
        }
        switch (command) {
          case "EHLO":
            socket.write("250-fake-smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
            break;
          case "HELO":
            reply("250 fake-smtp");
            break;
          case "AUTH": {
            const [mechanism, initial] = rest;
            if (mechanism?.toUpperCase() === "PLAIN" && initial) {
              const [, user, pass] = Buffer.from(initial, "base64").toString("utf8").split("\u0000");
              checkAuth(user, pass);
            } else if (mechanism?.toUpperCase() === "LOGIN") {
              mode = "auth-user";
              reply(`334 ${Buffer.from("Username:").toString("base64")}`);
            } else {
              reply("504 5.5.4 Unrecognized authentication type");
            }
            break;
          }
          case "MAIL":
            current = { from: /<([^>]*)>/.exec(line)?.[1] ?? "", to: [], data: "" };
            reply("250 2.1.0 OK");
            break;
          case "RCPT":
            current?.to.push(/<([^>]*)>/.exec(line)?.[1] ?? "");
            reply("250 2.1.5 OK");
            break;
          case "DATA":
            mode = "data";
            dataLines = [];
            reply("354 End data with <CR><LF>.<CR><LF>");
            break;
          case "RSET":
            current = null;
            reply("250 2.0.0 OK");
            break;
          case "NOOP":
            reply("250 2.0.0 OK");
            break;
          case "QUIT":
            reply("221 2.0.0 Bye");
            socket.end();
            break;
          default:
            reply("502 5.5.2 Command not implemented");
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;

  return {
    port,
    messages,
    connections: () => connectionCount,
    failNext: (command, replyLine) => {
      (failures[command] ??= []).push(replyLine);
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
