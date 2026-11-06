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

-- read (Int en Double; typgebruik.spp kiest hp_readInt of hp_readD)
class Read a where
  read :: String -> a

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

-- == Data.List, Data.Maybe, Data.Ord, Data.Function (in Haskell lite) ==
-- Ook een functie zonder klasse komt alleen in het programma als het haar
-- gebruikt (als kopie f__, typgebruik.spp).

sortBy :: (a -> a -> Ordering) -> [a] -> [a]
sortBy cmp xs = mergeAll (map (\x -> [x]) xs)
  where
    mergeAll [] = []
    mergeAll [ys] = ys
    mergeAll yss = mergeAll (mergePairs yss)
    mergePairs (a : b : rest) = merge a b : mergePairs rest
    mergePairs yss = yss
    merge [] bs = bs
    merge as [] = as
    merge (a : as) (b : bs) = case cmp a b of
      GT -> b : merge (a : as) bs
      _ -> a : merge as (b : bs)

sort :: Ord a => [a] -> [a]
sort xs = sortBy compare xs

sortOn :: Ord b => (a -> b) -> [a] -> [a]
sortOn f xs = map snd (sortBy (\a b -> compare (fst a) (fst b)) [(f x, x) | x <- xs])

insertBy :: (a -> a -> Ordering) -> a -> [a] -> [a]
insertBy cmp x [] = [x]
insertBy cmp x (y : ys) = case cmp x y of
  GT -> y : insertBy cmp x ys
  _ -> x : y : ys

insert :: Ord a => a -> [a] -> [a]
insert x ys = insertBy compare x ys

comparing :: Ord b => (a -> b) -> a -> a -> Ordering
comparing f a b = compare (f a) (f b)

on :: (b -> b -> c) -> (a -> b) -> a -> a -> c
on g f a b = g (f a) (f b)

maximumBy :: (a -> a -> Ordering) -> [a] -> a
maximumBy cmp (x : xs) = foldl (\m y -> case cmp y m of { LT -> m ; _ -> y }) x xs

minimumBy :: (a -> a -> Ordering) -> [a] -> a
minimumBy cmp (x : xs) = foldl (\m y -> case cmp y m of { LT -> y ; _ -> m }) x xs

groupBy :: (a -> a -> Bool) -> [a] -> [[a]]
groupBy eq [] = []
groupBy eq (x : xs) = (x : ys) : groupBy eq zs
  where (ys, zs) = span (eq x) xs

group :: Eq a => [a] -> [[a]]
group xs = groupBy (==) xs

partition :: (a -> Bool) -> [a] -> ([a], [a])
partition p xs = (filter p xs, filter (not . p) xs)

isPrefixOf :: Eq a => [a] -> [a] -> Bool
isPrefixOf [] ys = True
isPrefixOf (x : xs) [] = False
isPrefixOf (x : xs) (y : ys) = x == y && isPrefixOf xs ys

isSuffixOf :: Eq a => [a] -> [a] -> Bool
isSuffixOf xs ys = isPrefixOf (reverse xs) (reverse ys)

isInfixOf :: Eq a => [a] -> [a] -> Bool
isInfixOf xs ys = any (isPrefixOf xs) (tails ys)

stripPrefix :: Eq a => [a] -> [a] -> Maybe [a]
stripPrefix [] ys = Just ys
stripPrefix (x : xs) (y : ys) = if x == y then stripPrefix xs ys else Nothing
stripPrefix xs [] = Nothing

intersperse :: a -> [a] -> [a]
intersperse sep [] = []
intersperse sep (x : xs) = x : go xs
  where
    go [] = []
    go (y : ys) = sep : y : go ys

intercalate :: [a] -> [[a]] -> [a]
intercalate sep xss = concat (intersperse sep xss)

transpose :: [[a]] -> [[a]]
transpose [] = []
transpose ([] : xss) = transpose xss
transpose ((x : xs) : xss) = (x : [h | (h : _) <- xss]) : transpose (xs : [t | (_ : t) <- xss])

zipWith3 :: (a -> b -> c -> d) -> [a] -> [b] -> [c] -> [d]
zipWith3 f (a : as) (b : bs) (c : cs) = f a b c : zipWith3 f as bs cs
zipWith3 f as bs cs = []

unzip3 :: [(a, b, c)] -> ([a], [b], [c])
unzip3 xs = (map (\(a, b, c) -> a) xs, map (\(a, b, c) -> b) xs, map (\(a, b, c) -> c) xs)

scanl :: (b -> a -> b) -> b -> [a] -> [b]
scanl f q xs = q : (case xs of
  [] -> []
  (y : ys) -> scanl f (f q y) ys)

scanl1 :: (a -> a -> a) -> [a] -> [a]
scanl1 f (x : xs) = scanl f x xs
scanl1 f [] = []

scanr :: (a -> b -> b) -> b -> [a] -> [b]
scanr f q0 [] = [q0]
scanr f q0 (x : xs) = case scanr f q0 xs of
  qs@(q : _) -> f x q : qs

tails :: [a] -> [[a]]
tails [] = [[]]
tails (x : xs) = (x : xs) : tails xs

inits :: [a] -> [[a]]
inits [] = [[]]
inits (x : xs) = [] : map (x :) (inits xs)

subsequences :: [a] -> [[a]]
subsequences xs = [] : nonEmpty xs
  where
    nonEmpty [] = []
    nonEmpty (y : ys) = [y] : foldr (\zs r -> zs : (y : zs) : r) [] (nonEmpty ys)

-- Het algoritme van GHC (Data.List), voor dezelfde volgorde.
permutations :: [a] -> [[a]]
permutations xs0 = xs0 : permsGo xs0 []

permsGo :: [a] -> [a] -> [[a]]
permsGo [] is = []
permsGo (t : ts) is = foldr (permsIl t ts) (permsGo ts (t : is)) (permutations is)

permsIl :: a -> [a] -> [a] -> [[a]] -> [[a]]
permsIl t ts xs r = snd (permsIl2 t ts id xs r)

permsIl2 :: a -> [a] -> ([a] -> b) -> [a] -> [b] -> ([a], [b])
permsIl2 t ts f [] r = (ts, r)
permsIl2 t ts f (y : ys) r = let (us, zs) = permsIl2 t ts (f . (y :)) ys r in (y : us, f (t : y : us) : zs)

find :: (a -> Bool) -> [a] -> Maybe a
find p [] = Nothing
find p (x : xs) = if p x then Just x else find p xs

findIndex :: (a -> Bool) -> [a] -> Maybe Int
findIndex p xs = go 0 xs
  where
    go i [] = Nothing
    go i (y : ys) = if p y then Just i else go (i + 1) ys

elemIndex :: Eq a => a -> [a] -> Maybe Int
elemIndex x xs = findIndex (== x) xs

delete :: Eq a => a -> [a] -> [a]
delete x [] = []
delete x (y : ys) = if x == y then ys else y : delete x ys

union :: Eq a => [a] -> [a] -> [a]
union xs ys = xs ++ foldl (flip delete) (nub ys) xs

intersect :: Eq a => [a] -> [a] -> [a]
intersect xs ys = [x | x <- xs, x `elem` ys]

fromMaybe :: a -> Maybe a -> a
fromMaybe d Nothing = d
fromMaybe d (Just x) = x

isJust :: Maybe a -> Bool
isJust (Just x) = True
isJust Nothing = False

isNothing :: Maybe a -> Bool
isNothing m = not (isJust m)

catMaybes :: [Maybe a] -> [a]
catMaybes ms = [x | Just x <- ms]

mapMaybe :: (a -> Maybe b) -> [a] -> [b]
mapMaybe f xs = [y | Just y <- map f xs]

fromJust :: Maybe a -> a
fromJust (Just x) = x
