const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
let db = null;
const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");

const initialize = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("server started");
    });
  } catch (e) {
    console.log(`DB Error:${e.message}`);
  }
};
initialize();
app.post("/register/", async (request, response) => {
  const { username, name, password, gender } = request.body;

  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (password.length < 5) {
    response.status(400);
    response.send("Password is too short");
  } else if (dbUser === undefined) {
    const createUserQuery = `
      INSERT INTO 
        user (username, name, password, gender) 
      VALUES 
        (
          '${username}', 
          '${name}',
          '${hashedPassword}', 
          '${gender}'
        )`;
    const dbResponse = await db.run(createUserQuery);
    const newUserId = dbResponse.lastID;
    response.send("User created successfully");
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;

  const selectUserQuery = `SELECT * FROM user WHERE username='${username}'`;
  const dbUser = await db.get(selectUserQuery);

  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordCorrect = await bcrypt.compare(password, dbUser.password);

    if (isPasswordCorrect) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "SANTOSH");
      response.status(200);
      console.log(jwtToken);
      response.send({
        jwtToken: jwtToken,
      });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "SANTOSH", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        console.log(request.username);
        next();
      }
    });
  }
};

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userQuery = `SELECT user_id as userId FROM user WHERE username='${username}'`;
  const user = await db.get(userQuery);
  const { userId } = user;
  const sql = `
    SELECT user.username AS userName, tweet.tweet, tweet.date_time 
    FROM tweet 
    INNER JOIN follower ON tweet.user_id = follower.following_user_id
    INNER JOIN user ON tweet.user_id = user.user_id
    WHERE follower.follower_user_id = ${userId}
    ORDER BY tweet.date_time DESC 
    LIMIT 4
  `;
  const tweets = await db.all(sql);
  response.send(tweets);
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userQuery = `select user_id as userId from user where username='${username}'`;
  const player = await db.get(userQuery);
  const { userId } = player;
  console.log(userId);
  const sql = `SELECT user.name FROM user INNER JOIN follower ON user.user_id=follower.following_user_id WHERE follower.follower_user_id=${userId}`;

  let playersArray = await db.all(sql);

  response.send(playersArray);
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userQuery = `SELECT user_id FROM user WHERE username = '${username}'`;
  const user = await db.get(userQuery);

  if (!user) {
    return response.status(400).send("Invalid user");
  }

  const followersQuery = `
    SELECT u.name AS name
    FROM follower f
    INNER JOIN user u ON f.follower_user_id = u.user_id
    WHERE f.following_user_id = ${user.user_id}
  `;

  try {
    const followers = await db.all(followersQuery);
    const followerNames = followers.map((follower) => ({
      name: follower.name,
    }));

    response.status(200).json(followerNames);
  } catch (error) {
    console.error(error);
    response.status(500).send("Internal Server Error");
  }
});

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { username } = request;
  const tweetId = request.params.tweetId;

  const userQuery = `SELECT user_id FROM user WHERE username = '${username}'`;
  const user = await db.get(userQuery);
  const followingUserIdsQuery = `SELECT following_user_id FROM follower WHERE follower_user_id = ${user.user_id}`;
  const followingUserIds = await db.all(followingUserIdsQuery);
  const followingUserIdsArray = followingUserIds.map(
    (row) => row.following_user_id
  );

  const tweetQuery = `SELECT tweet, user_id, date_time FROM tweet WHERE tweet_id = ${tweetId}`;
  const tweet = await db.get(tweetQuery);

  if (!tweet) {
    return response.status(400).send("Invalid Request");
  }

  if (!followingUserIdsArray.includes(tweet.user_id)) {
    return response.status(401).send("Invalid Request");
  }

  const likesQuery = `SELECT COUNT(*) AS likes FROM like WHERE tweet_id = ${tweetId}`;
  const likes = await db.get(likesQuery);

  const repliesQuery = `SELECT COUNT(*) AS replies FROM reply WHERE tweet_id = ${tweetId}`;
  const replies = await db.get(repliesQuery);

  const tweetDetails = {
    tweet: tweet.tweet,
    likes: likes.likes,
    replies: replies.replies,
    dateTime: tweet.date_time,
  };

  response.status(200).json(tweetDetails);
});

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const tweetId = request.params.tweetId;

    // Check if the user follows the author of the tweet
    const userQuery = `SELECT user_id FROM user WHERE username = '${username}'`;
    const user = await db.get(userQuery);
    const followingUserIdsQuery = `SELECT following_user_id FROM follower WHERE follower_user_id = ${user.user_id}`;
    const followingUserIds = await db.all(followingUserIdsQuery);
    const followingUserIdsArray = followingUserIds.map(
      (row) => row.following_user_id
    );

    // Check if the tweet is from a user the current user follows
    const tweetQuery = `SELECT user_id FROM tweet WHERE tweet_id = ${tweetId}`;
    const tweet = await db.get(tweetQuery);

    if (!tweet) {
      return response.status(400).send("Invalid Request");
    }

    if (!followingUserIdsArray.includes(tweet.user_id)) {
      return response.status(401).send("Invalid Request");
    }

    // Get usernames who liked the tweet
    const likesQuery = `
    SELECT u.username
    FROM user u
    INNER JOIN like l ON u.user_id = l.user_id
    WHERE l.tweet_id = ${tweetId}
  `;
    const likes = await db.all(likesQuery);
    const likeUsernames = likes.map((like) => like.username);

    const responseObj = {
      likes: likeUsernames,
    };

    response.status(200).json(responseObj);
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;

    const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}'`;
    const currentUser = await db.get(getUserIdQuery);
    const currentUserID = currentUser.user_id;

    const getFollowingUserIdsQuery = `SELECT following_user_id FROM follower WHERE follower_user_id = ${currentUserID}`;
    const followingUsers = await db.all(getFollowingUserIdsQuery);
    const followingUserIdsArray = followingUsers.map(
      (user) => user.following_user_id
    );

    const getTweetUserIdQuery = `SELECT user_id FROM tweet WHERE tweet_id = ${tweetId}`;
    const tweet = await db.get(getTweetUserIdQuery);
    const tweetUserId = tweet.user_id;

    if (!followingUserIdsArray.includes(tweetUserId)) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getRepliesQuery = `
      SELECT user.name, reply.reply
      FROM user
      INNER JOIN reply ON user.user_id = reply.user_id
      WHERE reply.tweet_id = ${tweetId}
    `;
      const replies = await db.all(getRepliesQuery);

      const repliesArray = replies.map((reply) => {
        return {
          name: reply.name,
          reply: reply.reply,
        };
      });

      response.send({
        replies: repliesArray,
      });
    }
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;

  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}'`;
  const currentUser = await db.get(getUserIdQuery);
  const currentUserID = currentUser.user_id;

  const getTweetsQuery = `
    SELECT tweet.tweet, COUNT(DISTINCT like_id) AS likes, COUNT(DISTINCT reply_id) AS replies, tweet.date_time AS dateTime
    FROM tweet
    LEFT JOIN like ON tweet.tweet_id = like.tweet_id
    LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    WHERE tweet.user_id = ${currentUserID}
    GROUP BY tweet.tweet_id
    ORDER BY tweet.date_time DESC
  `;
  const tweets = await db.all(getTweetsQuery);

  const tweetsArray = tweets.map((tweet) => {
    return {
      tweet: tweet.tweet,
      likes: tweet.likes,
      replies: tweet.replies,
      dateTime: tweet.dateTime,
    };
  });

  response.send(tweetsArray);
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweet } = request.body;

  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}'`;
  const currentUser = await db.get(getUserIdQuery);
  const currentUserID = currentUser.user_id;

  const createTweetQuery = `
    INSERT INTO tweet (tweet, user_id, date_time)
    VALUES ('${tweet}', ${currentUserID}, datetime('now'))
  `;
  await db.run(createTweetQuery);

  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;

    const userQuery = `SELECT user_id as userId FROM user WHERE username='${username}'`;
    const player = await db.get(userQuery);
    const userId = player.userId;

    const tweetQuery = `SELECT * FROM tweet WHERE tweet_id=${tweetId}`;
    const tweet = await db.get(tweetQuery);

    if (!tweet) {
      response.status(400);
      response.send("Invalid request");
    } else if (tweet.user_id !== userId) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id=${tweetId}`;
      await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
