import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand
} from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({});

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "https://vishalafterhours.in"
};

export const handler = async (event) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod;
  const blogId = event?.pathParameters?.blogId;

  if (!blogId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: "blogId is required"
      })
    };
  }

  if (method === "GET") {
    const result = await client.send(
      new GetItemCommand({
        TableName: "VishalAfterHoursLikes",
        Key: {
          blogId: {
            S: blogId
          }
        }
      })
    );

    const likes = result.Item?.likes?.N
      ? Number(result.Item.likes.N)
      : 0;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        blogId,
        likes
      })
    };
  }

  if (method === "POST") {
    const result = await client.send(
      new UpdateItemCommand({
        TableName: "VishalAfterHoursLikes",
        Key: {
          blogId: {
            S: blogId
          }
        },
        UpdateExpression:
          "SET likes = if_not_exists(likes, :zero) + :one",
        ExpressionAttributeValues: {
          ":zero": {
            N: "0"
          },
          ":one": {
            N: "1"
          }
        },
        ReturnValues: "UPDATED_NEW"
      })
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        blogId,
        likes: Number(result.Attributes.likes.N)
      })
    };
  }

  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({
      error: "Method not allowed"
    })
  };
};