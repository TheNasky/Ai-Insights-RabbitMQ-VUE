import { ConfigService } from '@nestjs/config';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import amqp, { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import { QueueTaskMessage } from '../common/analysis.types';

type MessageHandler = (message: QueueTaskMessage) => Promise<void>;

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private readonly queueName = 'text_tasks';
  private readonly enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.enabled = this.configService.get<string>('NODE_ENV') !== 'test';
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Queue integration disabled in test environment');
      return;
    }

    const rabbitmqUrl =
      this.configService.get<string>('RABBITMQ_URL') ??
      'amqp://guest:guest@localhost:5672';

    const connection = await amqp.connect(rabbitmqUrl);
    const channel = await connection.createChannel();
    await channel.assertQueue(this.queueName, { durable: false });

    this.connection = connection;
    this.channel = channel;
    this.logger.log(`Connected to RabbitMQ queue "${this.queueName}"`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.channel) {
      await this.channel.close();
    }

    if (this.connection) {
      await this.connection.close();
    }
  }

  async publishTask(message: QueueTaskMessage): Promise<void> {
    if (!this.enabled) {
      return;
    }

    if (!this.channel) {
      throw new Error('RabbitMQ channel is not initialized');
    }

    this.channel.sendToQueue(
      this.queueName,
      Buffer.from(JSON.stringify(message)),
    );
  }

  async startConsumer(handler: MessageHandler): Promise<void> {
    if (!this.enabled) {
      return;
    }

    if (!this.channel) {
      throw new Error('RabbitMQ channel is not initialized');
    }

    await this.channel.consume(this.queueName, async (rawMessage) => {
      if (!rawMessage) {
        return;
      }

      try {
        const parsed = this.parseMessage(rawMessage);
        if (parsed) {
          await handler(parsed);
        }
        this.channel?.ack(rawMessage);
      } catch (error) {
        this.logger.error('Failed to process queue message', error);
        this.channel?.nack(rawMessage, false, false);
      }
    });
  }

  private parseMessage(rawMessage: ConsumeMessage): QueueTaskMessage | null {
    const rawContent = rawMessage.content.toString();
    try {
      return JSON.parse(rawContent) as QueueTaskMessage;
    } catch {
      this.logger.warn('Skipping invalid queue message payload');
      return null;
    }
  }
}
