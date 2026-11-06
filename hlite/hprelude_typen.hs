-- micro_haskell/hlite/hprelude_typen.hs -- de typen van de Prelude van
-- Haskell lite (hprelude.spp), voor de typechecker (typen.spp, H1).
-- Gelezen door de eigen parser. De standaardklassen staan hier als class
-- (H3); hun instances voor Int, Char, (), lijsten en tupels zijn ingebouwd in
-- typen.spp (Int is het enige getaltype), de rest via deriving of instance. Elke naam die een programma uit de
-- Prelude mag gebruiken, staat hier. De overladen functies (met Eq, Ord,
-- Show of Enum) hebben onderaan een body in Haskell lite: die worden per
-- type gespecialiseerd, net als die van het programma (H2b). De rest is
-- in Sapl (hprelude.spp).
module Prelude where

data Bool = False | True deriving (Eq, Ord, Show, Enum)
data Maybe a = Nothing | Just a deriving (Eq, Ord, Show)
data Either a b = Left a | Right b deriving (Eq, Ord, Show)
data Ordering = LT | EQ | GT deriving (Eq, Ord, Show, Enum)

(:) :: a -> [a] -> [a]

-- == De standaardklassen ==

class Eq a where
  (==), (/=) :: a -> a -> Bool
  x /= y = not (x == y)
  x == y = not (x /= y)

class Eq a => Ord a where
  compare :: a -> a -> Ordering
  (<), (<=), (>), (>=) :: a -> a -> Bool
  max, min :: a -> a -> a
  compare x y = if x == y then EQ else if x <= y then LT else GT
  x < y = case compare x y of { LT -> True ; _ -> False }
  x <= y = case compare x y of { GT -> False ; _ -> True }
  x > y = case compare x y of { GT -> True ; _ -> False }
  x >= y = case compare x y of { LT -> False ; _ -> True }
  max x y = if x <= y then y else x
  min x y = if x <= y then x else y

class Show a where
  show :: a -> String

class Num a where
  (+), (-), (*) :: a -> a -> a
  negate, abs, signum :: a -> a
  fromInteger :: Int -> a

class (Num a, Ord a) => Real a

class (Real a, Enum a) => Integral a where
  quot, rem, div, mod :: a -> a -> a
  divMod, quotRem :: a -> a -> (a, a)
  toInteger :: a -> Int

class Num a => Fractional a where
  (/) :: a -> a -> a
  recip :: a -> a

class Fractional a => Floating a where
  pi :: a
  exp, log, sqrt, sin, cos, tan, asin, acos, atan :: a -> a
  (**), logBase :: a -> a -> a

class (Real a, Fractional a) => RealFrac a where
  truncate, round, ceiling, floor :: Integral b => a -> b

realToFrac :: (Real a, Fractional b) => a -> b

class Enum a where
  succ, pred :: a -> a
  toEnum :: Int -> a
  fromEnum :: a -> Int
  enumFrom :: a -> [a]
  enumFromTo, enumFromThen :: a -> a -> [a]
  enumFromThenTo :: a -> a -> a -> [a]

gcd, lcm :: Integral a => a -> a -> a

-- IO
return :: a -> IO a
(>>=) :: IO a -> (a -> IO b) -> IO b
(>>) :: IO a -> IO b -> IO b
putStr :: String -> IO ()
putStrLn :: String -> IO ()
print :: Show a => a -> IO ()
putChar :: Char -> IO ()
mapM_ :: (a -> IO b) -> [a] -> IO ()
forM_ :: [a] -> (a -> IO b) -> IO ()
mapM :: (a -> IO b) -> [a] -> IO [b]
sequence_ :: [IO a] -> IO ()
when :: Bool -> IO () -> IO ()
unless :: Bool -> IO () -> IO ()

-- functies
id :: a -> a
const :: a -> b -> a
flip :: (a -> b -> c) -> b -> a -> c
(.) :: (b -> c) -> (a -> b) -> a -> c
($) :: (a -> b) -> a -> b
($!) :: (a -> b) -> a -> b
seq :: a -> b -> b
fst :: (a, b) -> a
snd :: (a, b) -> b
curry :: ((a, b) -> c) -> a -> b -> c
uncurry :: (a -> b -> c) -> (a, b) -> c
not :: Bool -> Bool
otherwise :: Bool
until :: (a -> Bool) -> (a -> a) -> a -> a
error :: String -> a
undefined :: a
maybe :: b -> (a -> b) -> Maybe a -> b
either :: (a -> c) -> (b -> c) -> Either a b -> c

-- getallen en tekens
(&&), (||) :: Bool -> Bool -> Bool
(^) :: (Num a, Integral b) => a -> b -> a
subtract :: Num a => a -> a -> a
fromIntegral :: (Integral a, Num b) => a -> b
even, odd :: Integral a => a -> Bool
ord :: Char -> Int
chr :: Int -> Char
isDigit, isUpper, isLower, isAlpha, isAlphaNum, isSpace :: Char -> Bool
toUpper, toLower :: Char -> Char
digitToInt :: Char -> Int

-- lijsten
(++) :: [a] -> [a] -> [a]
map :: (a -> b) -> [a] -> [b]
filter :: (a -> Bool) -> [a] -> [a]
foldr :: (a -> b -> b) -> b -> [a] -> b
foldl, foldl' :: (b -> a -> b) -> b -> [a] -> b
foldr1, foldl1 :: (a -> a -> a) -> [a] -> a
sum, product :: Num a => [a] -> a
length :: [a] -> Int
concat :: [[a]] -> [a]
concatMap :: (a -> [b]) -> [a] -> [b]
take, drop :: Int -> [a] -> [a]
splitAt :: Int -> [a] -> ([a], [a])
head, last :: [a] -> a
tail, init, reverse :: [a] -> [a]
null :: [a] -> Bool
zip :: [a] -> [b] -> [(a, b)]
zip3 :: [a] -> [b] -> [c] -> [(a, b, c)]
zipWith :: (a -> b -> c) -> [a] -> [b] -> [c]
unzip :: [(a, b)] -> ([a], [b])
replicate :: Int -> a -> [a]
iterate :: (a -> a) -> a -> [a]
repeat :: a -> [a]
cycle :: [a] -> [a]
takeWhile, dropWhile :: (a -> Bool) -> [a] -> [a]
span, break :: (a -> Bool) -> [a] -> ([a], [a])
and, or :: [Bool] -> Bool
any, all :: (a -> Bool) -> [a] -> Bool
(!!) :: [a] -> Int -> a
lines, words :: String -> [String]
unlines, unwords :: [String] -> String

-- == Overladen functies met een body (H2b) ==

elem :: Eq a => a -> [a] -> Bool
elem x [] = False
elem x (y : ys) = x == y || elem x ys

notElem :: Eq a => a -> [a] -> Bool
notElem x ys = not (elem x ys)

lookup :: Eq a => a -> [(a, b)] -> Maybe b
lookup k [] = Nothing
lookup k ((a, b) : rest) = if k == a then Just b else lookup k rest

maximum :: Ord a => [a] -> a
maximum (x : xs) = foldl' max x xs

minimum :: Ord a => [a] -> a
minimum (x : xs) = foldl' min x xs

nub :: Eq a => [a] -> [a]
nub [] = []
nub (x : xs) = x : nub (filter (/= x) xs)
