import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { PrismaClient } from '@prisma/client';
import { RpcException } from '@nestjs/microservices';
import { OrderPaginationDto } from './dto';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger('Orders-Service');

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async create(createOrderDto: CreateOrderDto) {
    try {
      const order = await this.order.create({ data: createOrderDto });
      return {
        existError: false,
        message: 'Order created successfully.',
        data: order,
      };
    } catch {
      throw new RpcException('An error occurred while performing this process');
    }
  }

  async findAll(pagination: OrderPaginationDto) {
    const { page, limit } = pagination;
    const totalOrders = await this.order.count();
    const lastPage = Math.ceil(totalOrders / limit);

    return {
      data: await this.order.findMany({
        skip: (page - 1) * limit,
        take: limit,
        where: { status: pagination.status },
      }),
      meta: {
        page,
        total: totalOrders,
        lastPage,
      },
    };
  }

  async findOne(id: string) {
    const orderDB = await this.order.findFirst({ where: { id } });

    if (!orderDB) {
      throw new RpcException({
        message: `Order with id: ${id} not found`,
        status: HttpStatus.BAD_REQUEST,
      });
    }

    return orderDB;
  }
}
