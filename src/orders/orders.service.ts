import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { PrismaClient } from '@prisma/client';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { ChangeOrderStatusDto, OrderPaginationDto, PaidOrderDto } from './dto';
import { firstValueFrom } from 'rxjs';
import { NATS_SERVICE } from 'src/config';
import { OrderWithProducts } from './interfaces/order-with-products.interface';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger('Orders-Service');

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  constructor(@Inject(NATS_SERVICE) private readonly client: ClientProxy) {
    super();
  }

  async create(createOrderDto: CreateOrderDto) {
    try {
      const productsIds = createOrderDto.items.map(
        (product) => product.productId,
      );

      const productsDB: any[] = await firstValueFrom(
        this.client.send({ cmd: 'validate_products' }, productsIds),
      );

      const totalAmount = createOrderDto.items.reduce((acc, orderItem) => {
        const price = productsDB.find(
          (product) => product.id === orderItem.productId,
        ).price;

        return price * orderItem.quantity;
      }, 0);

      const totalItems = createOrderDto.items.reduce((acc, orderItem) => {
        return acc + orderItem.quantity;
      }, 0);

      const order = await this.order.create({
        data: {
          totalAmount,
          totalItems,
          OrderItem: {
            createMany: {
              data: createOrderDto.items.map((orderItem) => ({
                productId: orderItem.productId,
                price: productsDB.find(
                  (product) => product.id === orderItem.productId,
                ).price,
                quantity: orderItem.quantity,
              })),
            },
          },
        },
        include: {
          OrderItem: {
            select: {
              price: true,
              quantity: true,
              productId: true,
            },
          },
        },
      });

      return {
        ...order,
        OrderItem: order.OrderItem.map((orderItem) => {
          return {
            ...orderItem,
            name: productsDB.find((prd) => prd.id === orderItem.productId).name,
          };
        }),
      };
    } catch {
      throw new RpcException({
        message: 'Check logs',
        status: HttpStatus.BAD_REQUEST,
      });
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
    const orderDB = await this.order.findFirst({
      where: { id },
      include: {
        OrderItem: {
          select: {
            price: true,
            quantity: true,
            productId: true,
          },
        },
      },
    });

    if (!orderDB) {
      throw new RpcException({
        message: `Order with id: ${id} not found`,
        status: HttpStatus.BAD_REQUEST,
      });
    }

    const productsIds = orderDB.OrderItem.map(
      (orderItem) => orderItem.productId,
    );

    const productsDB: any[] = await firstValueFrom(
      this.client.send({ cmd: 'validate_products' }, productsIds),
    );

    return {
      ...orderDB,
      OrderItem: orderDB.OrderItem.map((orderItem) => ({
        ...orderItem,
        name: productsDB.find((product) => product.id === orderItem.productId)
          .name,
      })),
    };
  }

  async changeStatus(statusDto: ChangeOrderStatusDto) {
    const { id, status } = statusDto;
    const orderDB = await this.findOne(id);

    const response =
      orderDB.status === statusDto.status
        ? orderDB
        : await this.order.update({
            where: { id },
            data: { status },
          });

    return {
      existError: false,
      message: 'Order updated succesfully.',
      data: response,
    };
  }

  async createPaymentSession(order: OrderWithProducts) {
    const paymentSession = await firstValueFrom(
      this.client.send('create.payment.session', {
        orderId: order.id,
        currency: 'usd',
        items: order.OrderItem.map((item) => ({
          name: item.name,
          price: item.price,
          quantity: item.quantity,
        })),
      }),
    );

    return paymentSession;
  }

  async paidOrder(paidOrderDto: PaidOrderDto) {
    this.logger.log('Paid Order');
    this.logger.log(paidOrderDto);

    await this.order.update({
      where: { id: paidOrderDto.orderId },
      data: {
        status: 'PAID',
        paid: true,
        paidAt: new Date(),
        stripeChargeId: paidOrderDto.stripeId,
        OrderReceipt: {
          create: {
            receiptUrl: paidOrderDto.receiptUrl,
          },
        },
      },
    });

    return {
      existError: false,
      message: 'Order Paid successfully.',
    };
  }
}
