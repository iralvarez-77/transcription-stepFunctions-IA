/** @format */

import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { randomUUID } from "crypto";
import DynamoService from "./dynamodb/dynamo";

const TABLE_NAME = process.env.GREETINGS_TABLE ?? "";
//Esto evita reinstanciar el cliente en cada invocación de Lambda.singleton
const dynamoService = DynamoService.getInstance(TABLE_NAME);

interface UserItem {
  id: string;
  name: string;
  date: string;
}

export const saveHello = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  console.log("👀 👉🏽 ~  context:", context);
  console.log("👀 👉🏽 ~  event:", event);
  const name = event.queryStringParameters?.name;

  try {
    if (!name)
      return response(400, { message: "La propiedad NAME es requerido" });

    const userItem: UserItem = {
      id: randomUUID(),
      name,
      date: new Date().toISOString(),
    };

    await dynamoService.putItem<UserItem>(userItem, {
      conditionExpression: "attribute_not_exists(#id_partition)",
      expressionAttributeNames: {
        "#id_partition": "id",
      },
    });

    return response(201, { message: "Item guardado éxitosamente", userItem });
  } catch (error) {
    console.error("Error al guardar en DynamoDB:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Error desconocido";
    return response(500, {
      message: "Error al guardar en DynamoDB",
      error: errorMessage,
    });
  }
};

const response = (statusCode: number, body: object): APIGatewayProxyResult => {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
};
