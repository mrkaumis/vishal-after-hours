import crypto from "node:crypto";

import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand
} from "@aws-sdk/client-dynamodb";

import {
  BedrockRuntimeClient,
  ApplyGuardrailCommand
} from "@aws-sdk/client-bedrock-runtime";

const dynamodb = new DynamoDBClient({
  region: "us-east-2"
});

const bedrock = new BedrockRuntimeClient({
  region: "us-east-2"
});

const TABLE_NAME = "VishalAfterHoursComments";

const GUARDRAIL_ID = "7x2oggqetez8";
const GUARDRAIL_VERSION = "4";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "https://vishalafterhours.in"
};

/*
 * Core abusive terms.
 *
 * We keep the dictionary relatively small and use
 * normalization + fuzzy matching to catch variations.
 */
const ABUSE_WORDS = [
  "chutiya",
  "chutiye",
  "bhosdike",
  "bhosdi",
  "madarchod",
  "madharchod",
  "bhenchod",
  "behenchod",
  "harami",
  "kamina",
  "kamini",
  "randi"
];

/*
 * Very short abbreviations are checked separately
 * because fuzzy matching on 2-letter words can cause
 * false positives.
 */
const ABUSE_ABBREVIATIONS = [
  "mc",
  "bc",
  "bsdk",
  "bhsdk"
];

/*
 * Normalize common character substitutions.
 */
function normalizeCharacters(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/@/g, "a")
    .replace(/\$/g, "s")
    .replace(/!/g, "i");
}

/*
 * Removes spaces and punctuation.
 *
 * Example:
 *
 * b h s d k
 * b.h.s.d.k
 *
 * both become:
 *
 * bhsdk
 */
function compactText(text) {
  return normalizeCharacters(text)
    .replace(/[^a-z0-9]/g, "");
}

/*
 * Calculate Levenshtein distance.
 *
 * This detects small typos such as:
 *
 * madarchod
 * madrchod
 *
 * Difference = 1
 */
function levenshteinDistance(a, b) {
  const matrix = Array.from(
    { length: b.length + 1 },
    () => new Array(a.length + 1).fill(0)
  );

  for (let i = 0; i <= b.length; i++) {
    matrix[i][0] = i;
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost =
        b[i - 1] === a[j - 1] ? 0 : 1;

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[b.length][a.length];
}

/*
 * Fuzzy matching.
 *
 * For longer abusive words:
 *
 * 6-7 chars  -> allow 1 typo
 * 8+ chars   -> allow up to 2 typos
 *
 * We deliberately keep the threshold conservative.
 */
function fuzzyContainsAbuse(text) {
  const normalized = compactText(text);

  for (const abuseWord of ABUSE_WORDS) {
    const target = compactText(abuseWord);

    if (normalized.includes(target)) {
      return true;
    }

    const maxDistance =
      target.length >= 8 ? 2 : 1;

    /*
     * Compare against windows approximately the
     * same size as the target word.
     */
    for (
      let start = 0;
      start < normalized.length;
      start++
    ) {
      for (
        let length =
          Math.max(1, target.length - maxDistance);
        length <= target.length + maxDistance;
        length++
      ) {
        const candidate =
          normalized.substring(
            start,
            start + length
          );

        if (!candidate) {
          continue;
        }

        /*
         * Don't fuzzy-match extremely short strings.
         */
        if (candidate.length < 5) {
          continue;
        }

        const distance =
          levenshteinDistance(
            candidate,
            target
          );

        if (distance <= maxDistance) {
          return true;
        }
      }
    }
  }

  return false;
}

/*
 * Exact detection for known short abbreviations.
 */
function containsAbbreviation(text) {
  const normalized =
    normalizeCharacters(text)
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const words = normalized.split(" ");

  return ABUSE_ABBREVIATIONS.some(
    (abbreviation) =>
      words.includes(abbreviation)
  );
}

/*
 * Main local moderation layer.
 */
function containsAbuse(text) {
  return (
    fuzzyContainsAbuse(text) ||
    containsAbbreviation(text)
  );
}

export const handler = async (event) => {
  const method =
    event?.requestContext?.http?.method ||
    event?.httpMethod;

  const blogId =
    event?.pathParameters?.blogId;

  try {
    /*
     * =========================
     * GET COMMENTS
     * =========================
     */
    if (method === "GET") {
      if (!blogId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: "blogId is required"
          })
        };
      }

      const result = await dynamodb.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: "blogId-index",
          KeyConditionExpression:
            "blogId = :blogId",
          FilterExpression:
            "#status = :approved",
          ExpressionAttributeNames: {
            "#status": "status"
          },
          ExpressionAttributeValues: {
            ":blogId": {
              S: blogId
            },
            ":approved": {
              S: "APPROVED"
            }
          }
        })
      );

      const comments =
        (result.Items || []).map(
          (item) => ({
            commentId:
              item.commentId?.S,

            name:
              item.name?.S ||
              "Anonymous",

            comment:
              item.comment?.S ||
              "",

            createdAt:
              item.createdAt?.S
          })
        );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          comments
        })
      };
    }

    /*
     * =========================
     * POST COMMENT
     * =========================
     */
    if (method === "POST") {
      let body;

      try {
        body = JSON.parse(
          event?.body || "{}"
        );
      } catch {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: "Invalid JSON"
          })
        };
      }

      const name =
        typeof body.name === "string"
          ? body.name.trim()
          : "";

      const comment =
        typeof body.comment === "string"
          ? body.comment.trim()
          : "";

      /*
       * Required fields
       */
      if (
        !blogId ||
        !name ||
        !comment
      ) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error:
              "blogId, name and comment are required"
          })
        };
      }

      /*
       * Name length
       */
      if (name.length > 100) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error:
              "Name must be 100 characters or less"
          })
        };
      }

      /*
       * Comment length
       */
      if (comment.length > 500) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error:
              "Comment must be 500 characters or less"
          })
        };
      }

      /*
       * =========================
       * LOCAL FUZZY MODERATION
       * =========================
       */
      if (
        containsAbuse(
          `${name} ${comment}`
        )
      ) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error:
              "Your comment contains inappropriate content."
          })
        };
      }

      /*
       * =========================
       * BEDROCK GUARDRAIL
       * =========================
       */
      const moderation =
        await bedrock.send(
          new ApplyGuardrailCommand({
            guardrailIdentifier:
              GUARDRAIL_ID,

            guardrailVersion:
              GUARDRAIL_VERSION,

            source: "INPUT",

            content: [
              {
                text: {
                  text:
                    `${name}\n${comment}`
                }
              }
            ]
          })
        );

      if (
        moderation.action ===
        "GUARDRAIL_INTERVENED"
      ) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error:
              "Your comment contains inappropriate content."
          })
        };
      }

      /*
       * =========================
       * SAVE APPROVED COMMENT
       * =========================
       */
      const commentId =
        crypto.randomUUID();

      await dynamodb.send(
        new PutItemCommand({
          TableName:
            TABLE_NAME,

          Item: {
            commentId: {
              S: commentId
            },

            blogId: {
              S: blogId
            },

            name: {
              S: name
            },

            comment: {
              S: comment
            },

            createdAt: {
              S:
                new Date()
                  .toISOString()
            },

            status: {
              S: "APPROVED"
            }
          }
        })
      );

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          message:
            "Comment posted",

          commentId
        })
      };
    }

    /*
     * =========================
     * METHOD NOT ALLOWED
     * =========================
     */
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        error:
          "Method not allowed"
      })
    };

  } catch (error) {
    console.error(
      "Comment operation failed:",
      error
    );

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error:
          "Unable to process comment"
      })
    };
  }
};