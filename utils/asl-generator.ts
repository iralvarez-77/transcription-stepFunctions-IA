import * as cdk from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as fs from 'fs';
import * as path from 'path';

export function enableAslAutoGeneration(stack: cdk.Stack, outputFileName: string): void {
  cdk.Aspects.of(stack).add({
    visit(node) {
      if (node instanceof sfn.CfnStateMachine) {
        if (node.definitionString) {
          const resolved = stack.resolve(node.definitionString);
          let cleanJson: any;

          // Si CDK generó un bloque Fn::Join por dependencias entre stacks, lo unimos limpiamente
          if (resolved && resolved['Fn::Join']) {
            const parts = resolved['Fn::Join'][1];
            const textArray = parts.map((part: any) => {
              if (typeof part === 'string') return part;
              if (part['Fn::GetAtt']) return `arn:aws:lambda:us-east-1:123456789012:function:${part['Fn::GetAtt'][0]}`;
              if (part['Ref']) return 'us-east-1';
              return '';
            });
            
            try {
              cleanJson = JSON.parse(textArray.join(''));
            } catch (e) {
              cleanJson = resolved;
            }
          } else if (typeof resolved === 'string') {
            cleanJson = JSON.parse(resolved);
          } else {
            cleanJson = resolved;
          }

          const outputDir = path.join(__dirname, '..', 'asl');
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }

          // CLAVE: El archivo DEBE terminar estrictamente en .asl.json para que VS Code lo reconozca
          const outputPath = path.join(outputDir, `${outputFileName}.asl.json`);
          fs.writeFileSync(outputPath, JSON.stringify(cleanJson, null, 2), 'utf-8');
        }
      }
    }
  });
}
