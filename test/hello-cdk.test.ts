
process.env.GREETINGS_TABLE = "table test"; 
import DynamoService from "../lambda/dynamodb/dynamo";
import { APIGatewayProxyEvent, Context } from "aws-lambda";
// import { saveHello } from "../lambda/index"; 
const mockPutItem = jest.fn();
console.log('👀 👉🏽 ~  mockPutItem:', mockPutItem)
jest.spyOn(DynamoService, "getInstance").mockReturnValue({
  putItem: mockPutItem,
} as unknown as DynamoService);


const { saveHello } = require("../lambda/index");

describe("saveHello Lambda function", () => {

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should return 400 if name is not provided", async () => {
    const event = {
      queryStringParameters: {},
    } as unknown as APIGatewayProxyEvent;

    const context = {} as Context;

    const result = await saveHello(event, context);
    console.log('👀 👉🏽 ~  result:', result)

    expect(result.statusCode).toBe(400);   
  })

  it("should return 201 if name is provided", async () => {
    const event = {
      queryStringParameters: { name: "alan" },
    } as unknown as APIGatewayProxyEvent;
    console.log('👀 👉🏽 ~  event:', event)

    const context = {} as Context;

    const result = await saveHello(event, context);
    console.log('👀 👉🏽 ~  result:', result)

    expect(result.statusCode).toBe(201);   
  })
})