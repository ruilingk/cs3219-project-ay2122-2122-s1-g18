const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const randomBytes = require('randombytes')

const User = require('../models/users')
const Token = require('../models/userToken')
const sendEmail = require('../utils/email')

function validateEmail (email) {
  const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
  return re.test(String(email).toLowerCase())
}

// GET all users
exports.getAllUsers = function (req, res) {
  User.find()
    .exec()
    .then(users => {
      res.status(200).json({
        message: 'Success: All Users Displayed!',
        data: users
      })
    })
    .catch(err => {
      res.status(500).json({
        error: err
      })
    })
}

// GET specific user
exports.getUser = function (req, res) {
  const id = req.params.userId
  User.findById(id)
    .exec()
    .then(user => {
      if (user) {
        res.status(200).json({
          message: 'Success: User found!',
          data: user
        })
      } else {
        res.status(400).json({
          message: 'Failure: Invalid ID. No User Found!'
        })
      }
    })
    .catch(err => {
      res.status(500).json({ error: err })
    })
}

// POST a new user
exports.createUser = function (req, res) {
  const email = req.body.email.trim()
  const username = req.body.username.trim()
  const password = req.body.password.trim()

  // checks if all fields are present
  if (!email || !username || !password) {
    return res.status(400).json({
      message: 'Failure: All Fields are Compulsory!'
    })
  }
  // validates email format
  if (!validateEmail(email)) {
    return res.status(400).json({
      message: 'Failure: Invalid Email Format!'
    })
  }
  // search for duplicate username or email
  const regex = (string) => new RegExp(['^', string, '$'].join(''), 'i')
  User.find({ $or: [{ email: regex(email) }, { username: regex(username) }] })
    .exec()
    .then(user => {
      if (user.length >= 1) {
        return res.status(409).json({
          message: 'Failure: Duplicate Username/Email!'
        })
      } else {
        bcrypt.hash(password, 10, (err, hash) => {
          if (err) {
            return res.status(500).json({
              error: err
            })
          } else {
            // create user object and save in database with relevant information
            const user = new User({
              email: email,
              password: hash,
              username: username
            })
            user.save()
              .then()
              .catch(err => {
                return res.status(500).json({
                  error: err
                })
              })
            // create a new token use to verify this user
            const token = new Token({
              userId: user._id,
              token: randomBytes(16).toString('hex')
            })
            token.save()
              .then(() => {
                const message = `http://localhost:8000/api/users/verify/${user.id}/${token.token}`
                sendEmail(user.email, 'Verify Email for PeerPrep', message)
                return res.status(200).json({
                  message: 'An email has been sent to your account. Please verify.'
                })
              })
              .catch(err => {
                return res.status(500).json({
                  error: err
                })
              })
          }
        })
      }
    })
}

// GET email verification
exports.getEmailVerification = async function (req, res) {
  const id = req.params.id
  const tokenId = req.params.token
  // find user by the unique ._id field
  const user = await User.findById(id)
    .exec()
    .then(user => {
      return user
    })
    .catch(err => {
      return res.status(500).json({ error: err })
    })
  if (user) {
    // find the token associated with this user
    const token = await Token.findOne({ userId: user._id, token: tokenId })
      .exec()
      .then(token => {
        // remove the token from database after verification
        return token
      })
      .catch(err => {
        return res.status(404).json({
          message: 'Failure: Invalid Token!',
          error: err
        })
      })
    if (token) {
      Token.findByIdAndRemove(token._id)
        .exec()
        .then()
        .catch(err => {
          return res.status(500).json({
            message: 'Failure: Unable to Remove Token',
            error: err
          })
        })
      // update user account status to verified
      User.updateOne({ _id: user._id }, { verify: true })
        .exec()
        .then(() => {
          return res.status(200).json({
            message: 'Email Verified. You can log in to your account now.'
          })
        })
        .catch(err => {
          return res.status(500).json({
            message: 'Failure: Unable to Update',
            error: err
          })
        })
    } else {
      return res.status(404).json({
        message: 'Failure: Invalid Link!'
      })
    }
  } else {
    return res.status(404).json({
      message: 'Failure: Invalid Link!'
    })
  }
}

exports.userLogin = function (req, res) {
  const username = req.body.username.trim()
  const password = req.body.password.trim()
  if (!username || !password) {
    return res.status(400).json({
      message: 'Authentication Failed: All Fields are Compulsory!'
    })
  }
  User.find({ username: username })
    .exec()
    .then(user => {
      if (user.length < 1) {
        return res.status(401).json({
          message: 'Authentication Failed: Wrong Username or Password!'
        })
      }
      bcrypt.compare(password, user[0].password, (err, result) => {
        if (err) {
          return res.status(401).json({
            message: 'Authentication Failed: Wrong Username or Password!'
          })
        }
        if (user[0].verify && result) {
          const token = jwt.sign({
            email: user[0].email,
            userId: user[0]._id,
            username: user[0].username
          },
          process.env.SECRET_KEY,
          {
            expiresIn: '3h'
          }
          )
          return res.status(200).json({
            message: 'Authentication successful',
            token: token
          })
        }
        if (!user[0].verify) {
          return res.status(401).json({
            message: 'Authentication Failed: Please verify account before continuing.'
          })
        } else {
          return res.status(401).json({
            message: 'Authentication Failed: Wrong Username or Password!'
          })
        }
      })
    })
    .catch(err => {
      return res.status(500).json({
        error: err
      })
    })
}

// DELETE all users and tokens
exports.deleteAllUsers = function (req, res) {
  User.deleteMany({})
    .exec()
    .then()
    .catch(err => {
      return res.status(500).json({
        message: 'Failure: Failed to Delete All Users!',
        error: err
      })
    })
  Token.deleteMany({})
    .exec()
    .then()
    .catch(err => {
      return res.status(500).json({
        message: 'Failure: Failed to Delete All Tokens!',
        error: err
      })
    })
  return res.status(200).json({
    message: 'Success: All Users and Tokens Deleted'
  })
}
