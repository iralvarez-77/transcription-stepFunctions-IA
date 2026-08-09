import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamo from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
export class HelloCdkStack extends cdk.Stack {

  public readonly saveHelloFunction: lambdaNodejs.NodejsFunction;
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const greetingsTable = new dynamo.Table(this, 'GreetingsTable', {
      partitionKey: { name: 'id', type: dynamo.AttributeType.STRING },
    });
    
    this.saveHelloFunction = new lambdaNodejs.NodejsFunction(this, 'SaveHelloFunction', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: 'lambda/index.ts',
      handler: 'saveHello', // Solo el nombre de la función exportada
      environment: {
        GREETINGS_TABLE: greetingsTable.tableName,
      },
    });

    // 3. Otorgar permisos de lectura/escritura a la Lambda sobre la Tabla
    greetingsTable.grantWriteData(this.saveHelloFunction);

    const helloAPI = new apigw.RestApi(this, 'helloApi');

    // 5. Integrar API Gateway con la Lambda
    const integration = new apigw.LambdaIntegration(this.saveHelloFunction);
    const hello = helloAPI.root.addResource('hello');
    hello.addMethod('POST', integration); 
  }
}
